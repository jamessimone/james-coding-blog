> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Mocking DML

> :Author src=github,date=2019-12-28T15:00:00.000Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

> I never met a unit test I didn't like. - Me, probably.

Hi everyone and welcome back to the [Joys of Apex](/). This time around, we'll be covering the all-important subject of unit testing. In the [Introduction](/intro) we covered TDD as it relates to Salesforce, and some early on project experience I had as a Salesforce developer that impressed upon me the need to have a snappy test suite:

- it encouraged quick iteration
- fast tests meant as feature requests rolled in and existing code was refactored, the team remained confident that regressions were being avoided
- fast deploys meant shipping features faster

I think we'd all like to ship features quickly and safely at the end of the day.

### Mocking DML through CRUD wrappers

To improve on the abysmal testing time of my first project, I began writing some failing tests:

```java
//in Crud_Tests.cls
@isTest
private class Crud_Tests {
    @isTest
    static void it_should_insert() {
        Contact con = new Contact(
            LastName = 'Washington',
            LeadSource = 'test'
            //other fields you require
        );
        new Crud().doInsert(con);
        System.assertNotEquals(null, con.Id);
    }
}
```

That leads to this familiar assertion failure:

```java
System.AssertException:
Assertion Failed:
Same value: null
```

Ouch. OK! Let's implement the method in our Crud class to fix this issue.

```java
public class Crud {
    public SObject doInsert(SObject record) {
        Database.insert(record);
        return record;
    }
}
```

Easy peasy. In fact, let's update the code so that we get both record and records-based ability to insert:

```java
//in Crud.cls
    public SObject doInsert(SObject record) {
        return this.doInsert(new List<SObject>{ record })[0];
    }

    public List<SObject> doInsert(List<SObject> records) {
        Database.insert(records);
        return records;
    }
```

You can imagine the implementation for the update, upsert, and delete methods ... but there's one gotcha!

```java
//in Crud_Tests.cls
@isTest
static void it_should_not_fail_on_update_due_to_chunking_errors() {
    /*this constant is normally kept in a class I call SalesforceLimits
    thanks to Xi Xiao for pointing out that though the salesforce
    error message returns "Cannot have more than 10 chunks in a single operation"
    if the objects are always alternating,
    the chunk size increases with each alternation, thus the error will occur
    in as little as 6 iterations */
    Integer MAX_DML_CHUNKS = 6;
    List<SObject> records = new List<SObject>();
    List<Account> accounts = new List<Account>();
    List<Contact> contacts = new List<Contact>();

    for(Integer i = 0; i < MAX_DML_CHUNKS; i ++) {
        Account a = new Account(Name = 'test' + i);
        accounts.add(a);
        records.add(a);

        Contact c = new Contact(LastName = test + i);
        contacts.add(c);
        records.add(c);
    }

    insert accounts;
    insert contacts;

    try {
        new Crud().doUpdate(records);
    } catch(Exception ex) {
        System.assert(false, ex);
        //should not make it here ...
    }
}
```

That brings about this lovely exception:

```java
System.AssertException:
Assertion Failed: System.TypeException:
Cannot have more than 10 chunks in a single operation.
Please rearrange the data to reduce chunking.
```

When developing in Apex, I think people quickly come to learn that no matter how much you know about the SFDC ecosystem, there are _always_ going to be new things to learn. Getting burned is also sometimes the fastest way to learn. I'm not an oracle -- this test is really a regression test, which only came up during active development on my second Salesforce org when our error logs started occasionally recording this error.

Let's fix the chunking issue:

```java
//in Crud.cls

public SObject doInsert(SObject record) {
    return this.doInsert(new List<SObject>{record})[0];
}
public List<SObject> doInsert(List<SObject> records) {
    this.sortToPreventChunkingErrors(records);
    Database.insert(records);
    return records;
}

public SObject doUpdate(SObject record) {
    return this.doUpdate(new List<SObject>{record})[0];
}
public List<SObject> doUpdate(List<SObject> records) {
    this.sortToPreventChunkingErrors(records);
    Database.update(records);
    return records;
}

private void sortToPreventChunkingErrors(List<SObject> records) {
    //prevents a chunking error that can occur
    //if SObject types are in the list out of order.
    //no need to sort if the list size is below the limit
    if(records.size() >= SalesforceLimits.MAX_DML_CHUNKING) {
        records.sort();
    }
}
```

And now the tests pass -- one gotcha down! I feel ready to take on the world!
![Just kidding...](/img/ready-to-take-on-the-world.jpg)

There's always one more gotcha in Apex (and gotchas = n + 1 is only true with the _gotchas I know_). Let's cover one more ... lovely ... issue:

```java
//in Crud_Tests.cls
@testSetup
private static void setup() {
    insert new Contact(FirstName = 'George');
}

@isTest
static void it_should_do_crud_upsert() {
    Contact contact = [SELECT Id FROM Contact];
    contact.FirstName = 'Harry';
    new Crud().doUpsert(contact);

    System.assertEquals('Harry', contact.FirstName);
}

//and in Crud.cls
public SObject doUpsert(SObject record) {
    return this.doUpsert(new List<SObject>{ record })[0];
}

public List<SObject> doUpsert(List<SObject> records) {
    this.sortToPreventChunkingErrors(records);
    Database.upsert(records);
    return records;
}
```

Which leads to:

```java

System.TypeException:
DML on generic List<SObject> only allowed for insert, update or delete.
```

OK ... didn't see that one coming. Let's fix it:

```java
//I know. Abstract. Has everyone gone crazy??
//Because Apex doesn't support static classes
//(which would have been the sane way to handle this)
//I like to make my static classes Abstract to prevent
//them from being improperly initialized.
public abstract class TypeUtils {
    public static List<SObject> createSObjectList(SObject record) {
        String listType = 'List<' + record.getSObjectType() + '>';
        List<SObject> records = (List<SObject>) create(listType);
        records.add(record);
        return records;
    }

    public static Object create(String objectName) {
        return Type.forName(objectName).newInstance();
    }
}

//and in Crud.cls
public SObject doUpsert(SObject record) {
    List<SObject> castRecords = TypeUtils.createSObjectList(record);
    return this.doUpsert(castRecords)[0];
}

```

Wow. OK. We've got our database wrapper ready to go, and all it took was a few years off my life, some gray hairs, a few shed tears, high cholesterol ... a small price to pay. Now let's get down to the actual business.

### Implementing the DML interface

In order to make use of this Crud class within our production level code while keeping our tests blazing fast, we're going to need a common interface:

```java
public interface ICrud {
    SObject doInsert(SObject record);
    List<SObject> doInsert(List<SObject> recordList);
    SObject doUpdate(SObject record);
    List<SObject> doUpdate(List<SObject> recordList);
    SObject doUpsert(SObject record);
    List<SObject> doUpsert(List<SObject> recordList);
    List<SObject> doUpsert(List<SObject> recordList, Schema.SObjectField externalIDField);
    SObject doUndelete(SObject record);
    List<SObject> doUndelete(List<SObject> recordList);

    void doDelete(SObject record);
    void doDelete(List<SObject> recordList);
    void doHardDelete(SObject record);
    void doHardDelete(List<SObject> recordList);
}
```

Implementing this in the base class is trivial:

```java
public virtual class Crud implements ICrud {
    //you've already seen the implementation ...
}
```

And **now** for my next trick ...

```java
//@isTest classes cannot be marked virtual
//bummer
public virtual class CrudMock extends Crud {
    public static List<SObject> InsertedRecords = new List<SObject>();
    public static List<SObject> UpsertedRecords = new List<SObject>();
    public static List<SObject> UpdatedRecords = new List<SObject>();
    public static List<SObject> DeletedRecords = new List<SObject>();
    public static List<SObject> UndeletedRecords = new List<SObject>();

    //prevent undue initialization
    private CrudMock() {}

    private static CrudMock thisCrudMock;

    //provide a getter for use
    public static CrudMock getMock() {
        if(thisCrudMock == null) {
            thisCrudMock = new CrudMock();
        }

        return thisCrudMock;
    }

        // DML
    public override List<SObject> doInsert(List<SObject> recordList) {
        TestingUtils.generateIds(recordList);
        InsertedRecords.addAll(recordList);
        return recordList;
    }
    // etc ...
}
```

A couple of things to note here:

- Insert / Upsert methods stub out Ids using a helper method. Since it's common in tests to confirm record insertion by positing the existence of an SObject's Id, stubbing Ids helps to decouple our tests from the mock DML implementation.
- @isTest classes cannot be marked virtual. You could make the argument that true test safety could be achieved by simply reimplementing the CrudMock class instead of extending the existing Crud class. I've gone back and forth on this many times.
- Within the CrudMock, we also ended up implementing some helpful getter methods for retrieving records of a specific Type. If you're testing a multi-step process with a lot of DML along the way, it can be helpful to pull back only the records you need to assert against. I'll use an example with Tasks below.

```java
//in a test class looking to get ONLY an inserted Task record
Task t = (Task) CrudMock.Inserted.Tasks.singleOrDefault;

//in CrudMock.cls
public static RecordsWrapper Inserted {
        get {
            return new RecordsWrapper(InsertedRecords);
        }
    }

    public static RecordsWrapper Upserted {
        get {
            return new RecordsWrapper(UpsertedRecords);
        }
    }

    public static RecordsWrapper Updated {
        get {
            return new RecordsWrapper(UpdatedRecords);
        }
    }

    public static RecordsWrapper Deleted {
        get {
            return new RecordsWrapper(DeletedRecords);
        }
    }

    public static RecordsWrapper Undeleted {
        get {
            return new RecordsWrapper(UndeletedRecords);
        }
    }

    public class RecordsWrapper {
        List<SObject> recordList;
        RecordsWrapper(List<SObject> recordList) {
            this.recordList = recordList;
        }

        public RecordsWrapper ofType(Schema.SObjectType sObjectType) {
            return new RecordsWrapper(this.getRecordsMatchingType(recordList, sObjectType));
        }

        public RecordsWrapper Accounts { get { return this.ofType(Schema.Account.SObjectType); }}

        public RecordsWrapper Leads { get { return this.ofType(Schema.Lead.SObjectType); }}

        public RecordsWrapper Contacts { get { return this.ofType(Schema.Contact.SObjectType); }}

        public RecordsWrapper Opportunities { get { return this.ofType(Schema.Opportunity.SObjectType); }}

        public RecordsWrapper Tasks { get { return this.ofType(Schema.Task.SObjectType); }}

        public Boolean hasId(Id recordId) {
            Boolean exists = false;
            for(SObject record : this.recordList) {
                if(record.Id == recordId) {
                    exists = true;
                }
            }
            return exists;
        }

        public Boolean hasId(Id whatId, SObjectField idField) {
            Boolean exists = false;
            for(SObject record : this.recordList) {
                if((Id)record.get(idField) == whatId) {
                    exists = true;
                }
            }
            return exists;
        }

        public Integer size() {
            return this.recordList.size();
        }

        public SObject singleOrDefault {
            get {
                if(recordList.size() > 1) {
                    throw new Exceptions.InvalidOperationException();
                }
                return recordList.size() == 0 ? null : recordList[0];
            }
        }

         public SObject firstOrDefault {
            get {
                if(recordList.size() > 0) {
                    return recordList[0];
                }
                return null;
            }
        }

        public List<SObject> getRecordsMatchingType(List<SObject> records, Schema.SObjectType sObjectType) {
            List<SObject> matchingRecords = new List<SObject>();
            for (SObject record : records) {
                if(record.getSObjectType() == sObjectType) {
                    matchingRecords.add(record);
                }
            }
            return matchingRecords;
        }
    }
```

Yeah. That's some boilerplate right there. In practice, the RecordWrapper helper for the CrudMock came into being only when we realized as a team that we were repetitively trying to filter records out of the static lists implemented in the CrudMock. And that's another important part of practicing TDD correctly: there's a reason I didn't lead with the ICrud interface when beginning this discussion. That would have been a "prefactor," or premature optimization. It wasn't relevant to the subject material at hand.

Try to avoid the urge to prefactor in your own Apex coding practice, and (when possible) encourage the same in your teammates. TDD at its best allows you (and a friend, if you are doing extreme / paired programming) to extract design elements and shared interfaces from your code as you go, as a product of making the tests pass. Some of the best code I've written on the Force.com platform was the result of refactors -- made possible by excellent unit tests, and the organic need to revisit code.

I've worked in orgs where you had to swim through layer after layer of abstraction to get to any kind of implementing code. In my experience, over-architecting code leads to unnecessary abstraction and terrible stacktraces. Maintaining the balance between code reusability and readability is of course a life-long see-saw.

---

Thanks for tuning in for another [Joys Of Apex](/) talk -- I hope this post encourages you to think outside the box about how to extract the database from impacting your SFDC unit test time. Next time around, we'll cover some important bridging ground -- now that you've got a DML wrapper for your Apex unit tests, how do you begin to enforce the usage of the actual Crud class in production level code while ensuring that whenever mocking is necessary in your tests, you can easily swap out for the CrudMock? The answer lies in everyone's favorite Gang Of Four pattern - the [Factory pattern](/dependency-injection-factory-pattern). (If you just read that and winced ... you truly have my apologies!)
