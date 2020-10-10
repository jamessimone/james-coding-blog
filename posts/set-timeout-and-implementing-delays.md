> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> setTimeout & Implementing Delays

> :Author src=github

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

Setting delays programmatically within Apex represents a unique challenge. We don't have access to the current thread instructions that are being carried out, nor do we have any kind of higher-level `delay` function. While this is frequently fine for internal usage, where the last thing you would want is for your compiled code to be slow, that's not always the case when interacting with external APIs. It's common for APIs to be "rate-limited" — go over the number of requests you're supposed to per second/minute etc ... and you can expect to be penalized. It's also common for the "penalty" to be communicated via HTTP response carrying instructions about how long you should back off for. But how can we safely implement delays or something like JavaScript's `setTimeout` in Apex without chewing through our precious CPU time limits?

This article is the result of a series of discussions that took place on the topic of rate-limiting APIs on the [SFXD Discord](https://join.sfxd.org/). The question — how to implement a delay while working with Batch/Queueable Apex interacting with a 3rd party API? — is actually two separate issues:

- how can we implement a delay mechanism in Apex?
- if we are using Batch Apex / a Queueable that returns a List of SObjects using SOQL to communicate changes to a third-party API, how can we assist the batch/queueable framework in determining which records have been processed versus which ones need to be retried at a later time?

## A Short Interlude: Using The Platform Cache

Short term, transient but persistent storage of records can be facilitated by taking advantage of the Platform Cache. This will obviate the need for the creation of another custom object (and the concomitant storage costs / cleanup requirements that would entail) while processing records ... it will also reduce the overall strain on our heap limits by lowering the surface area of our class-level storage (crucial when working with large lists).

Working on a problem indirectly, by working on another (storing application state, in this case pertaining to whether or not specific records have been processed), is a common paradigm in software engineering, and in many instances represents the intersection between computer science and mathematics ("I need a search algorithm that processes input in O(n) time for a fancy typeahead").

### The Cache.CacheBuilder Implementation

As with all approaches, there are pros and cons to taking advantage of Salesforce's Platform Cache. Caching is famously one of the hardest things to get right in an application. One of the sections in the developer documentation for the Platform Cache offers a delicious morsel up for those looking to avoid handling the classical difficulty of handling cache misses:

> A Platform Cache best practice is to ensure that your Apex code handles cache misses by testing for cache requests that return null. You can write this code yourself. Or, you can use the `Cache.CacheBuilder` interface, which makes it easy to safely store and retrieve values to a session or org cache.

It's frequently a good idea to opt into these Salesforce offerings, but not at the expense of performance (or time). I want to write some tests to ensure that making use of the Platform Cache won't be a bad choice further down the line by seeing how it performs when caching large numbers of records. First, the abstract implementation:

```java
/*not really necessary for the problem at hand
but useful when using the cache for mission-critical data
where a change to the underlying info necessitates
clearing the cache. Especially when the change
is due to a trigger, this allows us to only
expose the interface to the caller*/
public interface ICachedRepo {
  void clearCache();
}

public abstract class AbstractCacheRepo implements Cache.CacheBuilder, ICachedRepo {
  @testVisible private static Object stubValues;

  public Object doLoad(String requiredBySalesforce) {
    if(stubValues != null) {
      return stubValues;
    }
    return this.populateCache();
  }

  protected abstract String getCacheKey();

  protected Object getFromCache() {
    return Cache.Org.get(
      this.getCacheBuilder(),
      this.getCacheKey()
    );
  }

  public void clearCache() {
      Cache.Org.remove(
        this.getCacheBuilder(),
        this.getCacheKey()
      );
  }

  public void updateCache(Object cachedItem) {
    Cache.Org.put(
      this.getCacheKey(),
      cachedItem
    );
  }

  //this is whatever you're putting into the cache
  protected abstract Object populateCache();

  //only virtual because it allows inner classes in tests
  //to override
  protected virtual Type getCacheBuilder() {
    //the well-known hack for extracting the name
    //of the current class at runtime
    String className = String.valueOf(this)
      .split(':')[0];
    return Type.forName(className);
  }
}
```

Things of particular interest in the abstract implementation:

- the `stubValues` object allows tests to override how data is loaded; I won't show it off here, but especially if you are putting Master-Detail data into the cache, creating non-inserted objects is often crucial to ensure snappy test times
- this example won't get into the nitty-gritty of caching details (namespaces, and Session Cache), instead relying on the Org Cache. The same overall theory (abstracting away the implementation details) holds true if you're looking to take advantage of these features.

### Testing Cache.CacheBuilder & The AbstractCacheRepo

Right now, I'm more concerned with validating the performance of the cache (which should be _great_; that's the whole point of caching) rather than showing off the possibilities represented by the `AbstractCacheRepo`. When I write abstractions, I'm looking to consolidate behavior, showcase intent, and communicate platform intricacies (when necessary) to prevent unnecessary gotchas.

Assuming you have a scheduled job that is going to run, at a minimum, every 15 minutes (which is as frequent an interval that's possible on the SFDC platform) to check for changed records prior to calling out, you probably won't have the volume of records indicated here. Still, whenever possible, in testing I want to use the maximum number of SObjects (in regards to DML limits) to showcase what the worst-case will be in terms of latency. Comparing the use of the cache (which enables the usage of the crucial wrapper object to track processed records) to simply using SOQL will be key:

```java
@isTest
private class PlatformCacheTests {
    @TestSetup
    static void setup() {
        List<Account> accounts = new List<Account>();
        for(Integer index = 0; index < 9999; index++) {
            accounts.add(new Account(Name = 'Test' + index));
        }
        insert accounts;
    }


    @isTest
    static void it_should_measure_uncached_selection_time() {
        Map<Id, Account> accounts = new Map<Id, Account>([SELECT Id FROM Account]);

        //we want to establish a baseline iteration time, as well
        for(Id accountId : accounts.keySet()) {
            System.assertEquals(true, accounts.containsKey(accountId));
        }
    }

    @isTest
    static void it_should_measure_cached_selection_time() {
        CacheTest cacher = new CacheTest();
        Map<Id, SObjectWrapper> wrapperMap = cacher.getWrapperMap();

        List<Account> accounts = [SELECT Id FROM Account];
        for(Account acc : accounts) {
            System.assertEquals(true, wrapperMap.containsKey(acc.Id));
        }
    }

    private class CacheTest extends AbstractCacheRepo {
        public Map<Id, SObjectWrapper> getWrapperMap() {
            return (Map<Id, SObjectWrapper>) this.getFromCache();
        }

        protected override String getCacheKey() {
            return 'CacheTest';
        }

        protected override Object populateCache() {
            Map<Id, Account> accountMap = new Map<Id, Account>([SELECT Id FROM Account]);
            Map<Id, SObjectWrapper> wrapperMap = new Map<Id, SObjectWrapper>();
            for(Id accountId : accountMap.keySet()) {
                wrapperMap.put(accountId, new SObjectWrapper(accountMap.get(accountId)));
            }
            return wrapperMap;
        }

        protected override Type getCacheBuilder() { return CacheTest.class; }
    }

    public class SObjectWrapper {
        public SObjectWrapper(SObject record) {
            this.Record = record;
            this.IsProcessed = false;
        }

        public SObject Record { get; private set; }
        public Boolean IsProcessed { get; set; }
    }
}
```

And the output:

| Test Name | Time |
| —————————————————————————- | ——- |
| it-should-measure-cached-selection-time | .36s |
| it-should-measure-uncached-selection-time for loops | 1.12s |

In this case, I'm not necessarily concerned with the overall increase in time, particularly over a large number of records. Since we know we're going to be operating async in the context of the larger problem, adding ~700ms to the overall processing time (with a large number of records) seems worth it when the flipside would be the creation and maintanenace of a custom object.

You'll note that the tests aren't necessarily concerned with testing the `AbstractCacheRepo` — rather, they are exploring the cost of the feature set you buy into when making use of the Platform Cache. There are many different ways to approach testing, and this is closer to Domain Driven Design (DDD) than it is to my norm (being a big proponent of TDD and unit testing, I prefer for my test classes to not differ substantially in name from the class under test). I don't espouse this pattern for most production-level code, but for exploring patterns in the search of a meaningful (and performant) abstraction, writing tests to explore a platform (or API)'s capabilities is a wonderful way to learn.

On the subject of creating meaningful abstractions:

- they _shouldn't_ add cognitive overhead
- they _should_ unify pre-existing system/application concepts, either through DDD (does this provide me/my team with more information about what the business expects?) or refactoring (have I found a way to minimize verbosity by re-using similar concepts?)
- they _should_ utilize primitives or well-understood types whenever possible. The further an abstraction strays from the standard lib, the less likely it is to be well understood, documented, and used

—-

While writing this article, I was momentarily puzzled by an obscure stacktrace when running `PlatformCacheTests`:

```bash
System.NullPointerException: Attempt to de-reference a null object =>
Class.cache.Partition.validateCacheBuilder: line 167, column 1
Class.cache.Org.get: line 57, column 1
Class.AbstractCacheRepo.getFromCache: line 16, column 1
Class.PlatformCacheTests.CacheTest.getWrapperMap: line 32, column 1
Class.PlatformCacheTests.it_should_measure_cached_selection_time: line 25, column 1
```

Let's just ... ignore ... the casing on that "cache" class ... and focus on the null object. Since I was using a Developer Edition org when initially writing the test, my initial thought (involving smacking my own forehead) was that I hadn't enabled the Platform Cache feature. After enabling it, however, the error persisted, so I logged into another sandbox that was already using a version of the `AbstractCacheRepo` shown. The same error appeared there when running the test.

It was at this point that I remembered the issues I'd run into when writing the [Extendable API](/extendable-apis) article: `Type.forName` cannot "see" inner test classes without them both being publicly assessible _and_ having their outer class prefix attached. Having the method returning the `getCacheBuilder` method use the `virtual` keyword allows inner classes to override the implementation without forcing the inner class to be public. I like this better than the `@testVisible` static variable outlined in Extendable APIs (and below), but there's room for both approaches. Remember — "a foolish consistency is the hobgoblin of little minds."

```java
//AbstractCacheRepo.cls - the old way
@testVisible private static String classPrefix = '';
//...
private Type getCacheBuilder() {
  String className = String.valueOf(this)
    .split(':')[0];
  return Type.forName(classPrefix + className);
}

//PlatformCacheTests.cls
@isTest
static void it_should_measure_cached_selection_time() {
  AbstractCacheRepo.classPrefix = 'PlatformCacheTests.';
  //...
}

//AbstractCacheRepo.cls - the new way
//virtual to allow inner classes to override
protected virtual Type getCacheBuilder() {
  String className = String.valueOf(this)
          .split(':')[0];
  return Type.forName(className);
}

//PlatformCacheTests.cls - the new way
private class CacheTest extends AbstractCacheRepo {
  //...
  protected override Type getCacheBuilder() { return CacheTest.class; }
}
```

## Back On Track - Implementing Delays

It was at this point, after exploring the Platform Cache as a means to temporarily store state related to the records being processed that I took a left turn on continuity and came up with a more straightforward solution. This is the value in prototyping — I didn't think of this approach initially, but while exploring how to store which records had been processed as part of a batch, investigating the Platform Cache idea put me in the right mindset to arrive at a better solution.

### When Is A Batchable Not A Batchable?

You may remember that we explored Batchables and Queueables [when talking about the DataProcessor in Batchable & Queueable Apex](/batchable-and-queueable-apex). It shouldn't come as a surprise, then, that combining these two platform features into one can get you out of some tight corners. After working through the Platform Cache example, I realized it might be a red herring for this particular feature when thinking about how the `QueryLocator`/`Iterable` is returned by Batchable Apex's `start` method. If the data is already packaged into convenient-to-the-heap sizes, there's no harm in storing the requisite data within the object's memory.

So ... when is a Batchable not a Batchable? Perhaps the joke seems force(.com)d, but I'd say: _when it's also a Queueable_.

### Implementing A Timeout / Delay In Apex

For now, the delay implementation will be baked into the processing class itself. While this will fall short of true unit testing, it would be needlessly verbose to break out a timer to a separate class if it will only be used here. If there came a time where it was necessary to implement another time-based solution in a separate area of the codebase, I would certainly break out the interface and implementations I'm about to show you:

```java
public class SetIntervalProcessor implements
  Database.Batchable<SObject>, Database.AllowsCallouts, System.Queueable {
  public static final Integer CALLOUT_LIMIT = 5;

  //Interval section, constrained to this class
  //till cases for re-use present themselves
  //visibility level is public b/c of the tests
  public interface Interval {
    Boolean hasElapsed();
  }

  public class FirstInterval implements Interval {
      public boolean hasElapsed() {
        //on the first run, we simply process
        //as many requests as necessary
        return true;
      }
  }

  public class TenSecondDelay implements Interval {
      private final Datetime initialTime;
      public TenSecondDelay() {
        this.initialTime = System.now();
      }

      public Boolean hasElapsed() {
        return this.initialTime.addSeconds(10) <= System.now();
      }
  }

  //etc...
}
```

If you wanted to meld the testing for the delay into the overall tests for this class (so, not true unit testing), more power to you. I'll do both (testing the intervals, plus verifying that the full(y) set interval has elapsed when the full class is run), just to show how that will look:

```java
@isTest
private class SetIntervalProcessorTests {
  @isTest
  static void it_should_always_return_true_for_first_interval() {
    Integer counter = 0;
    SetIntervalProcessor.Interval interval
      = new SetIntervalProcessor.FirstInterval();
    while(true) {
      if(interval.hasElapsed() == false) {
        counter++;
      } else {
        break;
      }
    }

    System.assertEquals(0, counter);
  }

  @isTest
  static void it_should_wait_ten_seconds_for_ten_second_delay_interval() {
    Datetime nowish = System.now();
    SetIntervalProcessor.Interval tenSecDelay =
      new SetIntervalProcessor.TenSecondDelay();
    while(tenSecDelay.hasElapsed() == false) {
      //wait
    }
    System.assertEquals(true, nowish.addSeconds(10) <= System.now());
  }
}
```

If the delay truly needed to be this long in production, I would probably introduce another classic stub of mine, substituting the calls to `System.now()` with another class that allowed _tests only_ to override the current time; this would prevent having two or more tests guaranteed to take 10 seconds each. We can't afford to have tests that expensive in terms of time-incurred! But back to the matter at hand — the rest of the `SetIntervalProcessor` implementation:

```java
//SetIntervalProcessors.cls
  private final Interval interval;
  private List<SObject> records;
  @testVisible static Integer runCounter = 0;

  public SetIntervalProcessor() {
    this.interval = new FirstInterval();
  }

  //only for queueables
  private SetIntervalProcessor(Interval interval, List<SObject> records) {
    this.interval = interval;
    this.records = records;
  }

  public List<SObject> start(Database.BatchableContext context) {
    //your query here ...
    return [SELECT Id, Name FROM Account];
  }

  public void execute(Database.BatchableContext context, List<SObject> records) {
    this.records = records;
    this.innerExecute();
  }

  public void execute(System.QueueableContext context) {
    this.innerExecute();
  }

  public void finish(Database.BatchableContext context) {
    //..your finish logic
  }

  private void innerExecute() {
    while(this.interval.hasElapsed() == false) {
      //wait it out
    }
    Integer calloutCount = 0;
    for(Integer index = this.records.size() - 1;
      index >= 0
      //CALLOUT_LIMIT shown earlier (5)
        && calloutCount < CALLOUT_LIMIT
        && this.interval.hasElapsed();
      index—) {
      //we have to iterate backwards
      //to safely remove items from the list
      SObject record = records[index];
      this.callout(record);
      calloutCount++;
      this.records.remove(index);
    }
    if(this.shouldRunAgain()) {
      runCounter++;
      System.enqueueJob(new SetIntervalProcessor(
        new TenSecondDelay(),
        this.records
      ));
    }
  }

  private Boolean shouldRunAgain() {
    return this.records.size() > 0 &&
      Limits.getQueueableJobs() <= Limits.getLimitQueueableJobs();
  }

  private void callout(SObject record) {
    //whatever your callout logic is
    Http http = new Http();
    HttpRequest req = new HttpRequest();
    req.setEndpoint('https://httpstat.us/200');
    req.setBody(Json.serialize(record));
    http.send(req);
  }
```

Note that while the implementation currently enforces this class being kicked off as a batch first, it's not a hard requirement; so long as you were confident that the number of selected records was going to be less than the queryable limit, you could easily check if `this.records` was null in the `execute` method and set that variable by imperatively calling the `start` method from the Batchable implementation. I like the Queueable constructor being private, however — sometimes that extra security is worth sacrificing slightly on flexibility.

This post doesn't touch on handling callout limits — the example given is one where you would never exceed the maximum amount due to the aforementioned API rate limits.

If you want to go for a really clean, Object-Oriented re-queueing, the `interval` instance variable could have the `final` keyword removed:

```java
//SetIntervalProcessors.cls
//...
private Interval interval;
//...
private void innerExecute() {
   //..
  if(this.shouldRunAgain()) {
    runCounter++;
    this.interval = new TenSecondDelay();
    System.enqueueJob(this);
  }
}
```

I really like to pass `this` whenever possible with Queueables, but I also like the compiler ensuring that variables are only assigned to once. In this particular example, you can choose the pattern that more closely aligns with your values and style guide.

The rest of the tests focus on the Batchable/Queueable sections working as intended:

```java
@isTest
static void it_should_perform_as_batch_for_low_record_sizes() {
  Test.setMock(HttpCalloutMock.class, new MockHttpResponse(200));

  Test.startTest();
  Database.executeBatch(new SetIntervalProcessor());
  Test.stopTest();

  Account acc = (Account)JSON.deserialize(lastReqBody, Account.class);
  //remember, we iterate through the list in REVERSE!
  System.assertEquals('0', acc.Name);
}

@isTest
static void it_should_perform_as_queueable_and_wait_ten_seconds() {
  Test.setMock(HttpCalloutMock.class, new MockHttpResponse(200));

  insert new Account(Name = '5');
  Datetime nowish = System.now();

  Test.startTest();
  Database.executeBatch(new SetIntervalProcessor());
  Test.stopTest();

  Account acc = (Account)JSON.deserialize(lastReqBody, Account.class);
  System.assertEquals('0', acc.Name);
  //at least ten seconds should have elapsed
  System.assertEquals(true, nowish.addSeconds(10) <= System.now());
}

@isTest
static void it_should_try_to_requeue_for_larger_sizes() {
  //I added the string concatenation while debugging
  //to ensure everything was working correctly
  innerSetup('second ');

  insert new Account(Name = '9');

  Test.setMock(HttpCalloutMock.class, new MockHttpResponse(200));

  Exception ex;
  try {
      Test.startTest();
      Database.executeBatch(new SetIntervalProcessor());
      Test.stopTest();
  } catch(Exception e) {
      ex = e;
  }

  //Tests can only run a queueable once
  //verify the correct error has been thrown
  //and that the processor WOULD have requeued
  System.assertEquals('Maximum stack depth has been reached.', ex.getMessage());
  System.assertEquals(2, SetIntervalProcessor.runCounter);
}

static string lastReqBody;

private class MockHttpResponse implements HttpCalloutMock {
  private final Integer code;

  public MockHttpResponse(Integer code) {
    this.code = code;
  }

  public HTTPResponse respond(HTTPRequest req) {
    HttpResponse res = new HttpResponse();
    res.setStatusCode(this.code);
    lastReqBody = req.getBody();
    return res;
  }
}
```

I won't spend much time on the `MockHTTPResponse` class. Typically, this is not an inner class, but a shared one for many different tests. I've included the full body of it here simply to get the tests passing.

I don't love using things like the `runCounter` — I don't love Salesforce's limit on testing Queueables, either. The ability to make Queueables recursive is the reason they are as effective a tool as they are — disallowing people to fully test recursive Queueables is painful.

The tests take us through the three codepaths that are possible:

1. There aren't enough records to necessitate a further run. The Batch test ensures that the callouts are made. Yes, only the happy path for the HTTP requests are shown; error handling for HTTP requests is left as an exercise for the reader.
2. There are enough records to enqueue a second job, but not enough to enqueue again.
3. Not only are there enough records to enqueue, but it will take more than one iteration to get through all of the records.

Note, as well, that we are also testing that the job stops properly; that the list removal works as expected.

### But My Delay Needs To Be Longer!

OK, you're made it this far — but you're legitimately worried about running over CPU limits, due to limits being imposed by a foreign API that are more on the order of per-30-second/per-60-second limitations. In order to not run afoul of the governor limits, you _could_ utilize the Platform Cache in conjunction with bits of pieces of what I've already shown.

Alternatively, you could simply modify the beginning of the shown `innerExecute` method:

```java
private void innerExecute() {
  if(this.interval.hasElapsed() == false && this.shouldRunAgain()) {
    System.enqueueJob(this);
    return;
  }
  Integer calloutCount = 0;
  //... etc
}
```

There is no _advertised_ limit on the number of Queueable jobs running at any given time, though people have certainly speculated that Queueables and Batches share the same limit for concurrently running jobs (100). This approach could quickly burn through your limit for asynchronous Apex method executions per 24 hour period, however, which makes me loathe to recommend it. Still, I present it to you as an example of what _is_ possible; in this case, it also serves as a warning for the downsides to a promising possibility.

To avoid abusing both the async Apex method execution limit as well as the per-transaction CPU time limit, juggling your jobs between the Platform Cache and the previously shown `SetIntervalProcessor` method should suffice.

## setTimeout/Interval Closing Thoughts

In many ways, I'm glad that the Platform Cache experiment ended up being a tangent on the way towards an elegant solution for delays in Apex. Many dev stories involve heading down mental and written roads that end up being dead ends — showcasing that with something that could be of use to others in their own Platform Cache journeys is just an added benefit.

If the API rate limit was something truly heinous (and keeping in mind that at present, async processes in Apex get a maximum of 60 seconds to work with), having the Platform Cache (among other things) up our sleeve of options is a nice bonus to this exercise.

I've pushed the code shown in this post [to a branch in my Apex Mocks repo](https://github.com/jamessimone/apex-mocks-stress-test/tree/timeouts-and-delays) for your perusal. Note that some of the styling (in terms of linebreaks) is presented as it would be here, in order to preserve mobile-friendly display of the code, and does not represent how the code would look normally.

As always — thanks for following along, and I hope you enjoyed this entry in the Joys Of Apex!

—-

## setTimeout & Implementing Delays Postscript

I originally had announced in the [Picklist Validation post](/picklist-validation) way back in April that I was featured on the [SalesforceWay podcast](https://salesforceway.com/podcast/dml-mocking-for-apex-test/) with Xi Xiao, talking about DML mocking. The podcast episode was recorded at the end of March and released last week (so, the first week in August, 2021). Xi and I had a good talk discussing something I've talked about in length in [Mocking DML](/mocking-dml) and many other posts here! It's a fun, quick chat about a truly interesting topic — let me know your thoughts if you give the podcast a listen!

This is a mirrored post, you can find [the original setTimeout & Implementing Delays](https://www.jamessimone.net/blog/joys-of-apex/set-timeout-and-implementing-delays/) on my site!
