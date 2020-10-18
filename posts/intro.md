> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Introduction & Testing Philosophy

> :Author src=github,date=2019-12-27T15:00:00.000Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

Whether you're a seasoned Salesforce.com vet or somebody just getting into Apex development, it's my hope that this instructional series will prove fruitful for you. But a little background, first — I've been developing on the Salesforce.com (SFDC) ecosystem for more than 5 years, and in that time I went from working on an enormous project, with tens of millions of accounts, to a greenfield project that gradually expanded, to consulting for a variety of small to medium-sized companies.

Developing Salesforce's Apex code — itself, an interesting subset of Java — leads to many fun and interesting design decisions. Java is not the tersest programming language in the world, and while Apex does offer some extremely helpful shortcuts, it doesn't support lambda functions, and you'll need to jump through hoops to do any kind of "functions as first class citizens" argument passing, as well. With that being said, what Apex _does_ offer:

- built in unit testing capabilities
- built in DML (Data Manipulation Language) capabilities
- hundreds of Salesforce helper functions
- **required** code coverage to deploy

Take a look at that last bullet point: **required code coverage**. This is one of the hallmark characteristics of doing great development on the SFDC platform - writing strict unit tests that ensure your code is doing exactly what the business expects it to do. Indeed, because code coverage of over 75% is required in order to do production level deploys, Salesforce implicitly (and explicitly in its Trailhead articles) encourages Test Driven Development (or TDD).

## What is Test Driven Development?

Test Driven Development means, simply, that you don't write production level code till you have written a failing test asserting the behavior that you'd like to have happen.

A simple example might be structured like a user story:

> As a person in X department, I expect that when I save a phone number to an account, the phone number will be formatted.

In Apex, that might look something like:

```java
//in a test file annotated with @isTest at the top:
Account newAccount = new Account(Phone = '1234567890');
insert newAccount;

//change the reference for the Account by re-querying for it to observe
//whether or not the phone number has changed
//System.assertEquals(expected, actual) is one of many helper functions provided by SFDC
newAccount = [SELECT Phone FROM Account WHERE Id = :newAccount.Id];
System.assertEquals('123-456-7890', newAccount.Phone);
```

Without any custom code, this test will fail. That's great! Failure is your starting point in TDD - and I think that's really quite powerful. We don't start successful - we achieve success by building our way there. TDD is not just a software development philosophy, but a way to approach life humbly.

To close the example, an EXTREMELY simple and totally jury-rigged way of getting your test to pass:

```java | classes/AccountHandler.cls
//assuming you have a trigger written for Account
//(more on that later) that references this code:

public void beforeInsert(List<SObject> newRecords) {
    List<Account> newAccounts = (List<Account>) newRecords;
    //...processing code here
    this.formatPhoneNumbers(newAccounts);
}

private void formatPhoneNumbers(List<Account> newAccounts) {
    //regex patterns are supported in Apex, but they are cast to strings
    String nonDigits = '[^0-9]';
    for(Account account : newAccounts) {
        if(String.isNotBlank(account.Phone)) {
            String onlyDigits = account.Phone.replace(nonDigits, '');
            if(onlyDigits.length() == 10) {
                account.Phone = '(' + onlyDigits.substring(0, 3) + ') '
                    + onlyDigits.substring(3, 6) + '-'
                    + onlyDigits.substring(6);
            } else if (onlyDigits.length() == 11 && onlyDigits.substring(0, 1) == '1') {
                account.Phone = + onlyDigits.substring(1, 4) + ') '
                    + onlyDigits.substring(4, 7) + '-'
                    + onlyDigits.substring(7, 11);
            }
        }
    }
}

```

Remember: this is fast and dirty. I don't recommend deeply nested if statements in Apex, this code doesn't address obvious discrepancies (like the one presented by our test!) in terms of dealing with fake numbers, but despite the example's contrivance, you can well imagine how quickly a code base can become entangled in the pursuit of testing excellence if things start to look like this.

---

## Writing great tests

Writing great tests is not only the hallmark of a succesful Salesforce project, it's satisfying in the extreme. The principles I'm going to teach you can be applied to improve the code quality of an existing codebase, quality of life for you or your developers, and the speed with which a new project gets off the ground. I mention quality of life, in particular, because retaining good talent is one of the principle challenges employers deal with, and nothing impacts the velocity of a project quicker than unhappy or unmotivated developers. A clean code base in Apex exhibits several characteristics which make working in it fun:

- small functions with easily testable inputs and outputs
- fast tests - the quicker the turnaround time on test execution, the quicker devs can iterate
- a good balance between abstraction and implementation

A good example of how to balance abstraction and implementation is when writing tests: "Don't Repeat Yourself" (DRY) is a motto oft-uttered by developers, but it can be taken to an extreme. When writing Apex unit tests, in particular, it's easy to abstract away the setup of all your Salesforce objects (or SObjects) into helper functions, which can then take a variety of arguments to properly customize how the test is setup. In a code base where you are often making changes to the same few files, good helper functions for SObject creation are essential - but it's easy to take them too far. Don't fall into the trap of making the tests themselves unreadable by abstracting away so much of the essence of the test that, when new functionality is introduced and old tests break, make debugging the tests into a nightmare.

### Writing FAST Apex Unit Tests

The first SFDC project I worked on turned into a nightmare. It's a familiar story: a greenfield project got the go ahead, without a hard deadline, to sunset a legacy CRM system. This is Salesforce's bread and butter, eating into homegrown CRM nightmares and Oracle's marketshare alike by offering out of the box alternatives with easy setup. But then the user requirement gathering begins, the backlog begins to grow, and the team starts to struggle to continue to produce quality code given a deadline that suddenly materializes halfway through the project's beginnings. As new functionality is introduced at breakneck speed, existing unit tests start breaking. Small disruptions to forward progress turn into half-day headscratchers as the team tries to fix the broken tests. Things start getting commented out - after all, code coverage is high enough elsewhere to allow the deploys to continue. Code quality starts to suffer, with confusing conditonals and feature-flagged additions piling on.

The breaking point at my first job came when the flaky tests started ruining deployments that had gone from minutes to hours. There's nothing more heartbreaking than failing to deploy after watching the tests run for a few hours due to a flaky test. I walked away from that job confused and more than a little heartbroken - I'd poured more than two years of my life into a system that barely worked. What had gone wrong?

---

As I said, TDD starts with you failing. I recognized that my previous team's biggest issue boiled down to how long it took to deploy - and how long it took for our tests to run. Much of the lag time for running the tests was occurring because our custom objects were so branched from the standard Salesforce SObjects that it took many database inserts and updates in order to get objects into a workable state for our tests. It got me to wondering ... _how could I structure the tests on my next project so that our test time never suffered? Was such a thing possible?_

There were four problems with my first SFDC project:

- Tests took a long time to setup
- The database operations took a long time to process
- Flaky tests meant that deployments could fail arbitrarily
- Changes to objects often meant updating SOQL statements in dozens of locations

I decided to tackle the process of fixing the test time first. I was on a new project and sold my team the notion that our test time was going to be critical to ensure we could continually deliver. I went back to the drawing board with a friend of mine, Jonathan Gillespie, and we began to envision a way to mock the SFDC database in tests. The results were eye-popping! A properly setup environment - which took only a bit of boilerplate - could properly serve up production-ready code while allowing for objects to be easily mocked in our tests.

In order to simulate high testing loads produced by hundreds of tests running in parallel, we simulated the effects of the old tests by copying some simple tests with many updates (for example, properly setting up some OpportunityContactRole objects ...). Without a mocked database layer, these copied tests took about 45 minutes to run properly.

With the mocking framework in place, test times were reduced to mere minutes.

### How we did it

How did we get such a drastic reduction in test time? We found all the instances where DML statements like:

```java
insert newAccounts;
update newAccounts;
Database.upsert(newLeads);
Database.delete(contacts);
//and the most heinous statement of all:
Database.convertLead(lead);
```

Were used, and we replaced them with statements like this (more on this in the [Mocking DML](/mocking-dml) post):

```java
//in practice, these aren't static classes
//objects requiring DML have a Crud / LeadConverter
//passed to them

//insert / update / delete / convert are reserved words in Apex:
Crud.doInsert(newAccounts);
Crud.doUpdate(newAccounts);
Crud.doUpsert(newLeads);
Crud.doDelete(contact);
LeadConverter.convertLead(lead);
```

We also replaced all raw SOQL statements with an object, [`Repository`](/repository-pattern) that handles all database queries, is easily extended per object, and is easily replaced in tests through its interface. But I'm getting a bit ahead of myself. For now I'll wrap this up.

## Make Apex Unit Testing a Joy

TDD can either make or break a Salesforce project. Practicing it correctly - and using a testing framework that enforces good traditions and speedy tests - is paramount. I plan to cover in the coming months more info on how to set yourself up for success by explaining my testing framework through detailed code excerpts and fun examples.

If you enjoyed this introduction to the Joys of Apex, I'd <a href="mailto: james@sheandjim.com">love to hear from you]</a>, even a one-line note. Many thanks if you made it this far!

The original version of [The Joys Of Apex: Intro can be read on my blog.](https://www.jamessimone.net/blog/joys-of-apex/intro/)
