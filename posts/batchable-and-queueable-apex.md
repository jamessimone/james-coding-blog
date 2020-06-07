> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Batchable & Queueable Apex

> :Author src=github

Batchable and Queueable Apex are both powerful processing frameworks within Salesforce. Unlock the power of both Batchable and Queueable Apex with the easily extendable `DataProcessor` pattern, which I'll detail in this post. This has been a _long_ time coming. I've been dreaming of writing this post for years -- after getting burned with a few Batch Apex classes.

Reading the Apex docs concerning Batch Apex, it sounds like a dream come true:

> If you use a QueryLocator object, the governor limit for the total number of records retrieved by SOQL queries is bypassed. For example, a batch Apex job for the Account object can return a QueryLocator for all account records (up to 50 million records) in an org.

What the @%^!? _50 million records_ ?? God, we can all go home, the work's pretty much done for us (just kidding, we're all at home anyway). In reality, the use of Batch Apex is frequently a painful experience with:

- slow running batches
- intermittent failures (if one batch fails, the records being updated in it get rolled back ... but that's not true for the records in any of the other batches spawned through the process, good luck trying to diagnose issues in Batchable Apex that's been running with silent failures for a few days ...)

Being the chief offenders. Let's not even get onto the subject of maintaining the order of batches once they're in the Apex Flex Queue. Have you ever tried to hit a moving target? If you're one of the poor sods who's tried to juggle which Batch Jobs were executing at any given time, yes -- yes, you have tried. I've also already spoken about the Batchable boilerplate in the [Enum](enum-apex-class-gotchas/) post, so I won't beat on that horse.

With the introduction of Queueable Apex, it seemed that most people's prayers had been answered; queued jobs ran _fast_, and it's possible to write recursive Queueable Apex that (when set up correctly) gets around the DML row limit with carefully crafted queries that run in small batches ... essentially, fast Batchable Apex.

But after a few years of using Queueables instead of Batch Apex, I found myself really pushing the limits (no pun intended) of what was possible in a single transaction with **only** 10,000 rows that could be modified. The truth is, without good sentinel values on the records you're querying (some kind of `IsUpdated` flag), you can quickly run into trouble with Queueables running forever -- head back to the Apex Jobs setup page to try to stop the job before it restarts itself!

Plus, if you need to modify the sentinel value on 1,000 records, but those records could in turn be responsible for creating more than 9 records each (which is certainly possible with one-to-many relationships), you've just run into the kind of territory I was recently exploring for a client. Query too little, and the jobs will run inefficiently; query too much and you run into a Limit exception. Classic Salesforce.

## Introducing the DataProcessor

Let's take it back to the end of the [Repository](repository-pattern/) post. It's not _quite_ required reading for this post, but I do recommend it. The essentials are the use of the `Query` and `Repository` objects to encapsulate SOQL requests, and there'll be a necessary rehash below. That encapsulation is important because passing around Strings is a dangerous game ... and Batchable Apex sadly requires the use of Strings. To begin with, we'll need to revamp the `Repository` to safely encapsulate the `Database.QueryLocator` object that Batchables require in their `start` method. Unfortunately, there's no public constructor for this class, so we won't be able to mock a return value, but that's a story for another day. Here's what I'd like to test first:

```java
//in Repository_Tests.cls
@isTest
static void it_should_return_count_properly() {
    insert new Account(Name = 'Test');
    Query nameEqualsTest = new Query(Account.Name, Query.Operator.EQUALS, 'Test');
    IRepository repo = new Repository(Account.SObjectType, new List<SObjectField>());

    QueryWrapper wrapper = repo.getWrapper(nameEqualsTest);

    System.assertEquals(1, wrapper.ResultSize);
}
```

Pretty self-explanatory. The `QueryWrapper` object will encapsulate not only the `Database.QueryLocator` -- it will also receive an aggregated count for underlying requests. This will allow `DataProcessor` consumers to judge based on how many results are returned if it will be necessary to batch the request or enqueue it. Salesforce _does_ include the `Database.countQuery` method in the standard Apex library, but we'll need to tweak how the underlying query string is formed in order to properly conform to the format that `countQuery` expects. Let's review the implementation:

```java
//your garden-variety POJO...
public class QueryWrapper {
  public QueryWrapper(Database.QueryLocator locator, Integer resultSize) {
    this.Locator = locator;
    this.ResultSize = resultSize;
  }

  public Database.QueryLocator Locator { get; private set; }
  public Integer ResultSize { get; private set; }
}

//And then the full repository...
public class Repository extends Crud implements IRepository {
  private final Schema.SObjectType repoType;
  private final List<Schema.SObjectField> queryFields;

  private Boolean shortCircuit = false;

  public Repository(Schema.SObjectType repoType, List<Schema.SObjectField> queryFields) {
    this.repoType = repoType;
    this.queryFields = queryFields;
  }

  public QueryWrapper getWrapper(Query query) {
    return this.getWrapper(new List<Query>{ query });
  }

  public QueryWrapper getWrapper(List<Query> queries) {
    String queryString = this.getQueryString(queries);
    Integer resultSize = this.getAggregateResultSize(queries);

    Database.QueryLocator locator = Database.getQueryLocator(queryString);
    return new QueryWrapper(locator, resultSize);
  }

  public List<SObject> get(Query query) {
    return this.get(new List<Query>{ query });
  }

  public List<SObject> get(List<Query> queries) {
    String finalQuery = this.getQueryString(queries);
    System.debug('Query: \n' + finalQuery);
    List<SObject> results = this.getFromQuery(finalQuery);
    System.debug('Results: \n' + results);
    return results;
  }

  private String getQueryString(List<Query> queries) {
    String selectClause = 'SELECT ' + this.addSelectFields();
    String fromClause = this.getFrom();
    String whereClause = this.addWheres(queries);
    return selectClause + fromClause + whereClause;
  }

  private String addSelectFields() {
    Set<String> fieldStrings = new Set<String>{ 'Id' };
    for(SObjectField field : this.queryFields) {
        fieldStrings.add(field.getDescribe().getName());
    }
    return String.join(new List<String>(fieldStrings), ', ');
  }

  private String getFrom() { return '\nFROM ' + this.repoType;  }

  private String addWheres(List<Query> queries) {
    List<String> wheres = new List<String>();
    for(Query query : queries) {
        if(query.isEmpty()) { this.shortCircuit = true; }
        wheres.add(query.toString());
    }
    return '\nWHERE ' + String.join(wheres, '\nAND');
  }

  private List<SObject> getFromQuery(String queryString) {
    return shortCircuit ? new List<SObject>() : Database.query(queryString);
  }

  private Integer getAggregateResultSize(List<Query> queries) {
    String selectClause = 'SELECT Count()';
    String fromClause = this.getFrom();
    String whereClause = this.addWheres(queries);

    return Database.countQuery(selectClause + fromClause + whereClause);
  }
}
```

Apologies -- I normally paste snippets, but because this work builds on the class that was built in the Repository post, it was a little hard to avoid. That's the only rehash necessary, as the rest of the code is all new. The `QueryWrapper` object ends up with the info it needs, and we only burn one SOQL call in the meantime.

Initially, I was hoping to do something like the following with the `DataProcessor`:

```java
public abstract class DataProcessor {
  protected final Integer resultSize;
  //if you needed to, you could abort
  //at any time using the jobId
  protected Id jobId;

  public DataProcessor(Factory factory) {
    //implementers will use this constructor
    //to install dependencies
   }

  protected DataProcessor(QueryWrapper wrapper) {
    this.resultSize = wrapper.ResultSize;
  }

  //these end up being the only four methods
  //you would care about in your implementing classes
  protected virtual QueryWrapper getWrapper() {
    throw new DataProcessorException('Not Implemented');
  }
  protected virtual void execute(List<SObject> records) { }
  protected virtual void finish() { }
  protected virtual Boolean isBatchable() {
    return this.resultSize > Limits.getLimitDmlRows() / 3;
  }

  public void process() {
    QueryWrapper wrapper = this.getWrapper();
    //or some other sentinel value you override
    if(this.isBatchable()) {
      Database.executeBatch(new DataProcessorBatchable(wrapper));
    } else {
      System.enqueueJob(new DataProcessorQueueable(wrapper));
    }
  }
  //I would never do these linebreaks normally
  //but I know it helps with reading on mobile
  private virtual class DataProcessorBatchable
    extends DataProcessor
    implements Database.Batchable<SObject>, Database.Stateful {
    private final String queryLocatorString;
    protected DataProcessorBatchable(QueryWrapper wrapper) {
      super(wrapper);
      //trying to store Database.QueryLocator in an instance
      //variable leads to the dreaded
      //System.SerializationException:
      //Not Serializable: Database.QueryLocator error
      //cache the cleaned query string for re-use instead
      this.queryLocatorString = wrapper.Locator.getQuery();
    }

    public Database.QueryLocator start(Database.BatchableContext context) {
      this.jobId = context.getJobId();
      return Database.getQueryLocator(queryLocatorString);
    }
    public void execute(Database.BatchableContext context, List<SObject> records) {
      //if you were doing something really zany here
      //and the jobId had changed, you could re-save it here
      this.execute(records);
    }
    public void finish(Database.BatchableContext context) {
      //same
      this.finish();
    }
  }

  private virtual class DataProcessorQueueable
    extends DataProcessor
    implements System.Queueable {
    private final String query;

    protected DataProcessorQueueable(QueryWrapper wrapper) {
      super(wrapper);
      this.query = wrapper.Locator.getQuery();
    }

    public void execute(QueueableContext context) {
      this.jobId = context.getJobId();
      this.execute(Database.query(query));
      this.finish();
    }
  }

  private class DataProcessorException extends Exception{}
}
```

Unfortunately, I quickly ran into two errors that prevented the `DataProcessor` class from encapsulating the inner classes:

```bash
#First I had this problem in saving the above:
Error: Only top-level classes can implement Database.Batchable<SObject>
#Unlucky. Later, in testing the inner Queueable class:
System.AsyncException: Queueable cannot be implemented with other system interfaces.
```

This was a bit of a bummer -- I was really hoping to safely encapsulate the all of the processing logic within a single Apex class, hiding the implementation details.

Regardless, we'll still end up with a simple list of methods to override:

- `QueryWrapper getWrapper()` would have to be re-implemented by any consumer to prevent the exception from being thrown. This is because you need to dictate to the `DataProcessor` what kind of data you're getting
- `void execute(List<SObject> records)` to define all of the processing details for consumers
- optionally, `void finish()` and the sentinel `Boolean isBatchable()` for post-processing and for overriding the default implementation when necessary.

Since the second error I printed above was found while testing, I'll show the tests first:

```java
@isTest
private class DataProcessorTests {
  @TestSetup
  static void setup() {
    insert new Account(Name = ACCOUNT_NAME);
  }

  @isTest
  static void it_should_run_as_queueable_for_small_record_sizes() {
    runTest();
    System.assertEquals(
      'Completed',
      [SELECT Status FROM AsyncApexJob WHERE JobType = 'Queueable'].Status
    );
    //ensure batch didn't also run
    System.assertEquals(
      0,
      [SELECT Id FROM AsyncApexJob WHERE JobType = 'BatchApexWorker'].size()
    );
  }

  @isTest
  static void it_should_run_as_batchable_when_instructed_to() {
    batchable = true;
    runTest();
    System.assertEquals(
      'Completed',
      [SELECT Status FROM AsyncApexJob WHERE JobType = 'BatchApexWorker'].Status
    );
    //ensure queueable didn't also run
    System.assertEquals(
      0,
      [SELECT Id FROM AsyncApexJob WHERE JobType = 'Queueable'].size()
    );
  }

  static void runTest() {
    Test.startTest();
    //for actual implementers, you would actually
    //be calling Factory.getFactory().getTheImplementer.process();
    new TestAccountProcessor(Factory.getFactory()).process();
    Test.stopTest();

    Account updatedAccount = [SELECT Name FROM Account];
    System.assertEquals(ACCOUNT_NAME + ' TestAccountProcessor', updatedAccount.Name);
    System.assertEquals(true, finished);
  }

  static Boolean batchable = false;
  static Boolean finished = false;
  static String ACCOUNT_NAME = 'Hi';

  private class TestAccountProcessor extends DataProcessor {
    private final IRepository accountRepo;
    public TestAccountProcessor(Factory factory) {
      super(factory);
      //check out the Factory post if
      //you're scratching your head looking at this!
      this.accountRepo = factory.RepoFactory.getAccountRepo();
    }

    //a simple implementation that fetches all accounts
    //with the hard-coded name ... but in reality you could be
    //querying up to 50 million rows!
    protected override QueryWrapper getWrapper() {
      return this.accountRepo.getWrapper(
        new Query(Account.Name, Query.Operator.EQUALS, ACCOUNT_NAME)
      );
    }

    //a really terrible example implementation
    //but the sky's the limit, really
    //once this thing's kicked off, it can safely run
    //with however many records were queried for
    //in your getWrapper method
    protected override void execute(List<SObject> records) {
      List<Account> accounts = (List<Account>) records;
      for(Account acc : accounts) {
        acc.Name = acc.Name + ' TestAccountProcessor';
      }
      this.accountRepo.doUpdate(accounts);
    }

    protected override void finish() {
      finished = true;
    }

    protected override Boolean isBatchable() {
      return !batchable ? super.isBatchable() : batchable;
    }
  }
}
```

## Fixing the DataProcessor

I had to break the inner classes out into their own classes to get things working properly due to the limitations in inner classes shown above. Here's how things ended up:

```java
public abstract class DataProcessor {
  protected final Integer resultSize;
  protected final DataProcessor processor;

  protected Id jobId;

  public DataProcessor(Factory factory) { }

  //when you see a constructor like this
  //you know you're in for a good time
  protected DataProcessor(QueryWrapper wrapper, DataProcessor processor) {
    this.resultSize = wrapper.ResultSize;
    this.processor = processor;
  }

  protected virtual QueryWrapper getWrapper() {
    throw new DataProcessorException('Not Implemented');
  }
  protected virtual void execute(List<SObject> records) { }
  protected virtual void finish() { }
  protected virtual Boolean isBatchable() {
    return this.resultSize > Limits.getLimitDmlRows() / 3;
  }

  public void process() {
    QueryWrapper wrapper = this.getWrapper();
    if(this.isBatchable()) {
      //pass the current instance now that dependencies
      //have been setup
      Database.executeBatch(new DataProcessorBatchable(wrapper, this));
    } else {
      System.enqueueJob(new DataProcessorQueueable(wrapper, this));
    }
  }

  private class DataProcessorException extends Exception{}
}

public virtual class DataProcessorBatchable
  extends DataProcessor
  //etc, in either of these
  //you might need Database.Callout as well
  implements Database.Batchable<SObject>, Database.Stateful {
  private final String queryLocatorString;
  public DataProcessorBatchable(QueryWrapper wrapper, DataProcessor processor) {
      super(wrapper, processor);
      this.queryLocatorString = wrapper.Locator.getQuery();
  }

  public Database.QueryLocator start(Database.BatchableContext context) {
    this.jobId = context.getJobId();
    return Database.getQueryLocator(queryLocatorString);
  }
  public void execute(Database.BatchableContext context, List<SObject> records) {
    this.processor.execute(records);
  }
  public void finish(Database.BatchableContext context) {
    this.processor.finish();
  }
}

public virtual class DataProcessorQueueable
  extends DataProcessor
  implements System.Queueable {
  private final String query;

  public DataProcessorQueueable(QueryWrapper wrapper, DataProcessor processor) {
      super(wrapper, processor);
      this.query = wrapper.Locator.getQuery();
  }

  public void execute(QueueableContext context) {
      this.jobId = context.getJobId();
      this.processor.execute(Database.query(query));
      this.processor.finish();
  }
}
```

## Batchable & Queueable Summary

And the `DataProcessorTests` pass (in a third of a second, no less). It's important to note that passing the current processor instance using `this` in `DataProcessor.process` is the key to success here. This allows the Queueable / Batchable implementation to _only_ care about fulfilling the Salesforce interface requirements, while delegating the processing methodology to actual consumers. This also allows you to only test the things you need to test; the business logic written into the `execute` methods.

Though it requires three classes to properly setup the DataProcessor, I'm pleased with the results of this particular experiment. No more worrying about whether or not your Queueable is going to accidentally end up trying to process too many things. That's a great safety net to have! Plus, if your org rarely ventures into Batchable territory, if batches do end getting enqueued as query results grow in size, they'll have the chance to run at reasonable speeds (it's only when you're already heavily reliant on batches that slowdowns occur).

Another thing to note -- did anybody catch the missed opportunity on Salesforce's side in not having the `Context` objects inherit in a sane way? It's a shame that there isn't some base class with something like a `createdFromId` method; I'm fine with there being `QueueableContext`, and `SchedulableContext` and `BatchableContext` interfaces, etc ... but it's not very object-oriented, considering that in the end, regardless of what the context is, you're getting an Id related to the object's initialization.

So what do you think? Is the `DataProcessor` pattern something you're interested in implementing in your own org(s)? You can browse the full source code for this example on [my Github](https://github.com/jamessimone/apex-mocks-stress-test/tree/data-processor). I hope that this entry in the [Joys Of Apex](/) has proven enjoyable; stick around and check out the other posts if you're arriving here for the first time, and thanks for reading!
