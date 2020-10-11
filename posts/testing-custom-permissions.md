> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Testing Custom Permissions

> :Author src=github

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

Custom Permissions changed the game when it came to creating programmatic checks for feature management within Salesforce. Between Custom Metadata and Custom Permissions, Salesforce as a whole has been trying to _gently_ move people away from permissions management by way of hierarchical custom settings (or, even worse, iterating through Permission Sets!). And there's a lot to love when it comes to Custom Permissions. Since Winter '18, the `FeatureManagement.checkPermission` method has enabled developers to easily implement permission-based code routing. However ... when it comes time to testing feature-flagged code, how can we easily ensure that our tests remain isolated without polluting our test domain (or, even worse, unnecessarily exposing private methods merely to test the innards of a class)? Join me on the journey toward testing Custom Permissions painlessly!

---

## Intro: Feature-based Code Routes

Let's say we have a business requirement that asks for a task to be created based off of Opportunity owners when an API interaction from an external system identifies outreach as the next best step. This integration could be the result of Opportunity Stages being updated by a Sales person; it could be kicked off by an internal cron job; it could come from anywhere. The business would like to gradually roll this feature out to users without fully opting all of them in at once. This is the perfect use-case for Custom Permissions: we can feature flag the logic that creates the task, and opt users from Sales in as we please from a Permission Set with the Custom Permission included:

```xml
<!-- Is_API_Task_Creation_Enabled.customPermission-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<CustomPermission xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Should an API integration trigger the creation of Tasks for Sales users?</description>
    <label>Is API Task Creation Enabled</label>
</CustomPermission>
```

And the Permission Set:

```xml
<!-- Create_API_Task_For_Sales.permissionset-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <customPermissions>
        <enabled>true</enabled>
        <name>Is_API_Task_Creation_Enabled</name>
    </customPermissions>
    <hasActivationRequired>false</hasActivationRequired>
    <label>Create API Task For Sales</label>
    <license>Salesforce</license>
</PermissionSet>
```

Some example code, based off the premise that an update to an Opportunity triggers this action. It could be done synchronously, through a [trigger handler](/lightweight-trigger-handler), or asynchronously, through a [Queueable or Batch job](/batchable-and-queueable-apex). We'll start with the test for the happiest path:

```java
@isTest
private class OpportunityTaskHandlerTests {

  @isTest
  static void it_should_create_tasks_for_eligible_sales_people() {
    Opportunity opp = new Opportunity(OwnerId = UserInfo.getUserId());

    new OpportunityTaskHandler().createTasksForEligibleSalespeople(
      new List<Opportunity>{
          opp
      }
    );

    Task createdTask = [SELECT Id, OwnerId FROM Task];
    System.assertEquals(opp.OwnerId, createdTask.OwnerId, 'Owner Id didn\'t match for task!');
  }
}
```

We'll get started on that `OpportunityTaskHandler` object in a second; for now, of course, the test fails with the classic:

```bash
System.QueryException: List has no rows for assignment to SObject
```

Perfect. You'll note that we are actually getting an additional safety feature right out of the box; because there is no `LIMIT` command on the SOQL query for `createdTask`, we're also safe-guarding against future regressions where multiple Tasks might be introduced. With the advent of the Winter '21 release, you'll also note that next week we will be able to take advantage of the [Safe Navigation](https://releasenotes.docs.salesforce.com/en-us/winter21/release-notes/rn_apex_SafeNavigationOperator.htm) feature to perform the same query:

```java
Id actualOwnerId = [SELECT Id, OwnerId FROM Task]?.OwnerId;
System.assertEquals(opp.OwnerId, actualOwnerId, 'Owner Id didn\'t match for task!');
```

Of course, such syntax sugar only avails us in the event that we only need to assert for one thing, but I point it out here in the event that you haven't checked the release notes recently.

## Getting Our First Custom Permissions Test To Pass

Right now we have a failing test, but we also have zero functionality and no Custom Permissions wired up yet. Let's fix that:

```java
public without sharing class OpportunityTaskHandler {
    public static final String TASK_SUBJECT = 'You have 10 days to move this sale along!';

    public void createTasksForEligibleSalespeople(List<Opportunity> opps) {
    // here we will assume the passed in Opps are pre-filtered
        if(FeatureManagement.checkPermission('Is_API_Task_Creation_Enabled')) {
            this.createTasks(opps);
        }
    }

    private void createTasks(List<Opportunity> opps) {
        List<Task> tasksToInsert = new List<Task>();
        for(Opportunity opp : opps) {
            Task t = new Task(
                ActivityDate = System.today().addDays(10),
                OwnerId = opp.OwnerId,
                Subject = TASK_SUBJECT,
                WhatId = opp.AccountId,
                WhoId = opp.ContactId
            );
            tasksToInsert.add(t);
        }
        insert tasksToInsert;
    }
}
```

We'll use a public static `String` for the Task Subject to aid in testing, but you could just as easily use a Custom Label. The only other design decision to talk about is the routing -- the reference to the Custom Permission itself. In a more complicated ask, and a more sophisticated system, you might also choose to use some form of configuration or metadata to inject the name of the Custom Permission being used; instead of hard-coding `Is_API_Task_Creation_Enabled`, you'd have the ability to swap Custom Permission(s) dynamically. [James Hou has several interesting POCs on how this might be accomplished](https://github.com/tsalb/feature-flag-designs) -- while these feature-flag systems are not production ready, looking through the patterns in that repo might help you in your own search for best practices regarding customizations like this. But I digress -- back to it.

We've got our functionality -- let's get back to our test! One thing we can do is validate that the test has been setup correctly before touching anything else:

```java
// in OpportunityTaskHandlerTests

@isTest
static void it_should_create_tasks_for_eligible_sales_people() {
  System.assertEquals(false, FeatureManagement.checkPermission('Is_API_Task_Creation_Enabled'));
  // ...
}
```

One of a few things I'm not thrilled with concerning the `checkPermission` method? It should throw an exception, in my opinion, if you pass in a Custom Permission name that doesn't exist. It doesn't do that. This is one of the other reasons I brought up the feature-flagging framework, above -- it's important that you isolate and minimize String-based parameters, both in your tests and in production-level code. It's too easy for misspellings to go unnoticed, especially if you aren't giving yourself the safety net that tests represent. Though it consumes an extra SOQL call, there is some wisdom to be gained in wrapping the `checkPermission` method to validate that the Custom Permission in question actually exists ... for the moment, we'll hold off on implementing something like that.

Anyway. The test is still failing. Let's address that. One possible way to do so -- and the method we'll employ first -- is to assign the Permission Set featuring the Custom Permission to our test user. There are ample pitfalls to this approach -- which we'll cover shortly -- but we're head's-down in the "red, green, refactor" TDD methodology at the moment, and the only thing that matters presently is getting that test to pass.

Permission Sets are metadata; they're retrievable in our tests without having to use the 'seeAllData` test attribute (and you shouldn't be using that attribute anyway). If you aren't familiar with how Users are assigned to Permission Sets within Apex, the process is refreshingly simple:

```java
@isTest
static void it_should_create_tasks_for_eligible_sales_people() {
  System.assertEquals(false, FeatureManagement.checkPermission('Is_API_Task_Creation_Enabled'));

  PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'Create_API_Task_For_Sales'];
  PermissionSetAssignment psa = new PermissionSetAssignment(
    AssigneeId = UserInfo.getUserId(),
    PermissionSetId = ps.Id
  );
  //...
}
```

Yes! Writing Apex is fun _and_ easy! With any luck, we'll be done with this requirement before lun--

```bash
System.QueryException: List has no rows for assignment to SObject
```

Wait, what. Why is there still no Task being created? Is there some kind of async process surrounding permissions that is preventing the call to `FeatureManagement.checkPermissions` from returning true? Sure enough, debugging shows the value has not changed even after the Permission Set has been assigned. Well, that's OK -- we're veterans of async deception in Apex, which means we know wrapping this thing in `Test.startTest` / `Test.stopTest` should force all async actions -- including the presumed permissions updating -- to complete. I'm thinking maybe I'll have a caprese sandwi--

```bash
List has no rows for assignment to SObject
```

Hmm. OK, that ... didn't work. I didn't expect that. What about if we wrap the calling code in `System.runAs`? Even though we're _already_ running the test as ourself, maybe there's something about running the test in another context that will help:

```java
@isTest
static void it_should_create_tasks_for_eligible_sales_people() {
  System.assertEquals(false, FeatureManagement.checkPermission('Is_API_Task_Creation_Enabled'));

  PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'Create_API_Task_For_Sales'];
  PermissionSetAssignment psa = new PermissionSetAssignment(
    AssigneeId = UserInfo.getUserId(),
    PermissionSetId = ps.Id
  );

  // See the repo if you haven't seen
  // these Id generators before
  Opportunity opp = new Opportunity(
    AccountId = TestingUtils.generateId(Account.SObjectType),
    ContactId = TestingUtils.generateId(Contact.SObjectType),
    OwnerId = UserInfo.getUserId()
  );


  System.runAs(new User(Id = UserInfo.getUserId())) {
    new OpportunityTaskHandler().createTasksForEligibleSalespeople(
      new List<Opportunity>{
          opp
      }
    );
  }

  // Added asserts for all the functionality
  Task createdTask = [SELECT Id, ActivityDate, OwnerId, WhatId, WhoId FROM Task];
  System.assertEquals(System.today().addDays(10), createdTask.ActivityDate, 'Activity Date didn\'t match for task!');
  System.assertEquals(opp.OwnerId, createdTask.OwnerId, 'Owner Id didn\'t match for task!');
  System.assertEquals(opp.AccountId, createdTask.WhatId, 'What Id didn\'t match for task!');
  System.assertEquals(opp.ContactId, createdTask.WhoId, 'Who Id didn\'t match for task!');
}
```

I'll spare you the drama -- the test is still failing. I'm recreating this experience, step-by-painful-step, as it happened to me when I first went to work on a feature like this. When it _was_ happening to me, in the moment, I'll admit -- I was tempted to give up. I already had a test passing that verified the objects in question (which were not Opportunities for the project I was working on, but the same concept applies) were being filtered correctly. I knew the project's code coverage was high enough that a few untested -- and admittedly simple -- lines were unlikely to arouse suspicion or red flags. But that's not the **Joys Of Apex** way. Indeed, the thought of giving up so galled me that I was driven to continue. Deeper into the mysterious SObjects known as "Setup Objects" we will have to go ...

## Working With Setup Objects In Apex Tests

There are quite a few objects that belong to the "Setup Object" category, which becomes relevant to us since we would like to both manipulate these objects and perform other DML (the Task insertion) within our test. We are typically spoiled when it comes to documentation on the SFDC platform, and [this is no exception](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dml_non_mix_sobjects.htm). Here are some of the more pertinent objects that I've run into which can generate the dreaded "mixed DML" setup object error when writing unit tests:

- User
- Profile
- PermissionSet
- PermissionSetAssignment
- ObjectPermissions (but, confusingly, not FieldPermissions ?)
- SetupEntityAccess

It's that last one -- `SetupEntityAccess` -- which will prove crucial to aiding and abetting our unit tests. It turns out that in addition to the `PermissionSetAssignment` object, which is still required, we _also_ need to ensure that our Permission Set is correctly set up with the reference for the Custom Permission in order for our test to work. This also forces us to make our test fully independent from the Permission Set that we've created -- which is great. Since Permission Sets can be changed without running all tests, it's possible to remove the Custom Permission we've created from our Permission Set and deploy without anybody being the wiser -- until our unit tests are run the next time a code update is deployed! We'll remove that possible failure point from our codebase and enjoy clean code in the process.

I'll also mention that even after all of this was pieced together, I still had to do the `Test.startTest()` / `Test.stopTest()` song and dance prior to _finally_ having success with just the plain `System.runAs(user)` method -- only in the `runAs` context is a User's Custom Permission status successfully re-calculated during testing!

Here's what creating the full list of objects necessary to tie everything together looks like:

```java
// in TestingUtils
public static void activateCustomPerm(Id userId, String permissionName) {
  PermissionSet ps = new PermissionSet(
    Name = 'CustomPermissionEnabled',
    Label = 'Custom Permisison Enabled'
    );
  insert ps;

  SetupEntityAccess sea = new SetupEntityAccess(
    ParentId = ps.Id,
    SetupEntityId = [
      SELECT Id
      FROM CustomPermission
      WHERE DeveloperName = :permissionName
      LIMIT 1
    ].Id
  );

  PermissionSetAssignment psa = new PermissionSetAssignment(
    AssigneeId = userId,
    PermissionSetId = ps.Id
  );

  insert new List<SObject>{ sea, psa };
}
```

Putting it all together, our test now looks like:

```java
@isTest
static void it_should_create_tasks_for_eligible_sales_people() {
  TestingUtils.activateCustomPerm(
    UserInfo.getUserId(),
    'Is_API_Task_Creation_Enabled'
  );

  Opportunity opp = new Opportunity(
    AccountId = TestingUtils.generateId(Account.SObjectType),
    ContactId = TestingUtils.generateId(Contact.SObjectType),
    OwnerId = UserInfo.getUserId()
  );

  // runAs is REQUIRED to recalc the user's permissions
  System.runAs(new User(Id = UserInfo.getUserId())) {
    new OpportunityTaskHandler().createTasksForEligibleSalespeople(
      new List<Opportunity>{
          opp
      }
    );
  }

  Task createdTask = [SELECT Id, ActivityDate, OwnerId, WhatId, WhoId FROM Task];
  // mobile friendly asserts
  // sorry desktop users!
  System.assertEquals(
    System.today().addDays(10),
    createdTask.ActivityDate,
    'Activity Date didn\'t match for task!'
  );
  System.assertEquals(
    opp.OwnerId,
    createdTask.OwnerId,
    'Owner Id didn\'t match for task!'
  );
  System.assertEquals(
    opp.AccountId,
    createdTask.WhatId,
    'What Id didn\'t match for task!'
  );
  System.assertEquals(
    opp.ContactId,
    createdTask.WhoId,
    'Who Id didn\'t match for task!'
  );
}
```

_Now_ we get a different error:

```bash
INVALID_CROSS_REFERENCE_KEY, invalid cross reference id
```

This is because the Ids generated by `TestingUtils` aren't recognized by the database as valid -- because the given Account and Contact records do not exist. This is where dependency injection / use of the Stub API comes into play, going back to the [Mocking DML article](/mocking-dml):

```java
// in OpportunityTaskHandler
private final ICrud crud;

public OpportunityTaskHandler(ICrud crud) {
    this.crud = crud;
}

 private void createTasks(List<Opportunity> opps) {
   List<Task> tasksToInsert = new List<Task>();
   // loop through opps
   // create tasks
   this.crud.doInsert(tasksToInsert);
 }
```

And in the test:

```java
System.runAs(new User(Id = UserInfo.getUserId())) {
  new OpportunityTaskHandler(CrudMock.getMock()).createTasksForEligibleSalespeople(
    new List<Opportunity>{
        opp
    }
  );
}

Task createdTask = (Task)CrudMock.Inserted.Tasks.singleOrDefault;
```

Note that the `singleOrDefault` method throws if more than one element is present -- the same as our old SOQL query safe-guard. Excellent. And the test passes! But maybe you're more into the Stub API these days? This is a great chance to plug [Suraj Pillai's UniversalMock](https://github.com/surajp/universalmock) Stub API framework for easy stubbing. There is one critical limitation with the Stub API, however -- you can't mock private methods.

This means that for mocking DML, you're still "stuck" having a DML wrapper of sorts -- which would then allow you to use the mock like so:

```java
// In OpportunityTaskHandlerTests
UniversalMocker mock = UniversalMocker.mock(Crud.class);
ICrud crudMock = (ICrud)mock.createStub();

System.runAs(new User(Id = UserInfo.getUserId())) {
  new OpportunityTaskHandler(crudMock).createTasksForEligibleSalespeople(
    new List<Opportunity>{
        opp
    }
  );
}

List<Task> createdTasks = (List<Task>)((Map<String, Object>)mock
  .forMethod('doInsert')
  .getArgumentsMap())
  .get('records');
Task createdTask = createdTasks[0];
// etc with your asserts ...
```

For mocking DML, I find the use of the Stub API a bit heavy, but it's good to point out its flexibility to people who may not be aware that a whole host of other options are available to them when testing complicated objects.

## Wrapping Up Testing Custom Permissions

We've successfully decoupled our tests from any one Permission Set existing, and also shown how to test for the existence of Custom Permissions in isolation. The negative test -- simply verifying that no Task is created if the User does not have the Custom Permission enabled -- is left as a trivial exercise for the reader. The more serious task would be wrapping calls to `FeatureManagement`, as mentioned earlier, to validate that the Custom Permission exists -- you can afford the extra SOQL call, hopefully, but this also makes the method non-bulk-safe.

Anyway, we've planted the seed for extensible permissions-based routing. I don't have the answer for how to best dynamically gate functionality ... at the moment, I would probably go the route of Custom Metadata being fed into a system calling `FeatureManagement.checkPermission`, with sensible defaults. One problem with the dynamic version of feature flagging is that it puts the onus on the business as a whole to eliminate dead code routes when certain features are deprecated; if your tests are properly self-isolating, the only way you would know that code was no longer reachable would be if somebody went and deleted the Custom Permission in question ... otherwise, if it hangs out, without being assigned to any Permission Set, you have no intuitive, in-system, way to validate a feature being deprecated.

Despite this dead-code issue, I hope that I've given you plenty to think about when it comes to Custom Permissions. Worst case scenario, I'm simply confirming what you already know -- Custom Permissions play nicely within Apex; you just need to be sure your tests are properly decoupled. I've uploaded the [example code if you want to browse through on Github](https://github.com/jamessimone/apex-mocks-stress-test/tree/testing-custom-permissions) -- till next time!

**Note** - the original version of this article can be read [on jamessimone.net](https://www.jamessimone.net/blog/joys-of-apex/testing-custom-permissions/)
