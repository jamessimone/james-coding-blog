> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Lazy Iterators

> :Author src=github

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

Welcome back to the [Joys Of Apex](/)! You may remember from the [footnotes of Sorting & Performance In Apex](/sorting-and-performance-in-apex#fn-1) that I mentioned [an article on iterators](https://nebulaconsulting.co.uk/insights/list-processing-in-apex/), which I first read in February while browsing the Salesforce subreddit. One thing that I dwelt on for some time after reading the article was how my clients might be able to use the power of lazy iteration - which differs from the eager iteration performed by the traditional "for" loops we use quite often in SFDC Apex development - to speed up trigger handlers. Were there performance gains to be had by delaying the evaluation of records in a Trigger context? I would also highly recommend the YouTube video that is posted in the article: this talk on [lazy evaluations from GOTO 2018](https://www.youtube.com/watch?v=bSbCJUSaSkY) is fantastic

I was impressed at the time with the object-oriented approach that Aidan Harding and the folks over at Nebula Consulting had undertaken when implementing the Lazy Iterator framework. The idea for this article has been brewing since then. Their `LazyIterator` object uses the Decorator pattern to add functionality to the underlying iterators found on all Salesforce `List` objects -- reading through their codebase got me re-excited about working with collections in Apex. You may recall from the [Writing Performant Apex Tests](/writing-performant-apex-tests) post that using iterators to page through collections is much faster than any of the "for" loop implementations!

I'd also like to thank Aidan for generously proof-reading the beta version of this, which led to a couple of great edits. This article is assuredly better for his input.

## A Short History Of Lazy Evaluation

> All problems in computer science can be solved using one more level of indirection. -- David Wheeler

So-called "Lazy" evaluated functions have their actual execution delayed until a "terminator" function is called. It's common for lazy functions to be chained together using fluent interfaces, culminating with actions being performed when the terminator function is called. What can Salesforce developers writing Apex code stand to gain by learning more about lazy functions?

Fluent interfaces -- or objects that return themselves during function calls -- also tend to satisfy one of the prerequisites for Object-Oriented Programming; namely, encapsulation. While fluency as a property of functions/objects has become associated more with functional programming than with OOP, many developers are being unwittingly exposed to pseudo-fluent interfaces (and, as a result, functional paradigms) through the JavaScript collection API; it's not uncommon to see various `filter`, `map`, and `reduce` calls being chained together when iterating through lists in JavaScript. It's also not uncommon for people to underestimate the performance implications that come with using these functions -- in JavaScript's vanilla functions' case, our code's readability increases at the cost of performance:

## Eager Evaluation in JavaScript & Apex

```javascript
const list = [1, 2, 3, 4, 5, 6, 7];
const doubleOfEvens = list.filter((x) => x % 2 === 0).map((num) => num * 2);

console.log(doubleOfEvens);
//output: [ 4, 8, 12 ]
```

Well-named (and encapsulated) functions are appreciated by developers because they are easy to understand. Even if you don't know JavaScript, you can look at the above code snippet and divine its meaning: _given a starting list of numbers, take the ones that don't have a remainder when divided by two, and multiply those values **by** two_. However, when you look at what that code is effectively doing, you might begin to feel differently about it:

```javascript
var list = [1, 2, 3, 4, 5, 6, 7];
var evens = [];
for (var i = 0; i < list.length; i++) {
  var num = list[i];
  if (num % 2 === 0) {
    evens.push(num);
  }
}

var doubleOfEvens = [];
for (var index = 0; index < evens.length; index++) {
  var even = evens[index];
  doubleOfEvens.push(even * 2);
}
```

Yikes. Turning back to Apex, you might immediately see the parallels between this example and how a typical Apex trigger handler is set up:

```java
public class AccountHandler extends TriggerHandler {

  public override void beforeInsert(List<SObject> newRecords) {
    List<Account> accounts = (List<Account>)newRecords;

    this.trimAccountName(accounts);
    this.formatAccountPhone(accounts);
    //etc ...
  }

  private void trimAccountName(List<Account> accounts) {
    for(Account acc : accounts) {
      acc.Name = acc.Name.normalizeSpace();
    }
  }

  private void formatAccountPhone(List<Account> accounts) {
    for(Account acc : accounts) {
      // do stuff with the phone
    }
  }
}
```

This pattern is pretty typical. It's not uncommon in larger organizations for the big objects -- Leads and Opportunities in particular -- to have dozens (if not hundreds) of trigger handler methods, each of which likely involves sifting through the entirety of the old/new records prior to performing business logic. As trigger handlers grow in size, related functionality is frequently broken out into other classes; this tends to obscure just how much processing is occurring as a handler churns through records.

Once records are being updated, many developers have utility methods designed to compare the old and new objects handed to SFDC developers in the form of `Trigger.old` and `Trigger.new` lists, but even these utility methods frequently take the form of iterating over the entirety of the old and new records to isolate matches. (This becomes a problem when you need to isolate many different groups of changed records to do further processing; e.g. Accounts that need their Opportunities updated, Accounts that need their Contacts updated, if a particular Opportunity Line Item is added, go back to the Account, etc ...) So what can we do? _Should_ we do something to address this "problem" -- or is it really not a problem at all, but one of the results of a growing system? As usual, to answer that question, we're going to have to write some tests.

## Measuring SObject Trigger Performance

These particular tests will make use of Queueable Apex. _Why_ use Queueables over our typical Apex tests? There's an argument to be made (by some) that the overhead introduced by the test classes themselves actually obscure the production-level performance results. I haven't found that to be the case, but with long-running operations, it's possible for running tests to time out, so we'll be avoiding that issue altogether. In order to avoid hitting any kind of _Anonymous Apex_ timeouts, we'll choose the easiest of the async Apex implementations to rig up a timer:

```java
public class QueueableTimer implements System.Queueable {
  private Datetime lastTime;

  public QueueableTimer() {
    this.lastTime = System.now();
  }

  public void execute(QueueableContext context) {
    Savepoint sp = Database.setSavepoint();
    List<Account> accounts = this.getExampleAccountsToInsert();
    this.log('Starting execute after gathering sample records');

    insert accounts;

    this.log('Ending');
    Database.rollback(sp);
  }

  private List<Account> getExampleAccountsToInsert() {
    List<Account> accounts = new List<Account>();
    //savepoint usage consumes a DML row ...
    for(Integer index = 0; index < 9998; index++) {
      accounts.add(
        new Account(
          Name = ' Testing' + index.format() + ' ',
          Phone = '8438816989'
        )
      );
    }
    return accounts;
  }

  private void log(String startingString) {
    System.debug(
      startingString + ', time passed: '
      + this.getSecondsPassed().format()
      + ' seconds'
    );
    this.lastTime = System.now();
  }

  private Decimal getSecondsPassed() {
    return ((Decimal)(System.now().getTime()
      - this.lastTime.getTime()))
      .divide(1000, 4);
  }
}
```

This code is going to interact with our extremely plain `AccountHandler` object, called by the trigger on Accounts:

```java
public class AccountHandler extends TriggerHandler {
  public override void beforeInsert(List<SObject> insertedRecords) {
    //no methods for now
  }
}
```

Right now, with the `beforeInsert` method empty, kicking off the `QueueableTimer` prints the following:

```bash
Starting execute after gathering sample records, time passed: 0.788 seconds
Ending, time passed: 32.035 seconds
```

It's important to note that the baseline is being measured _prior_ to the `Savepoint` being rolled back. Something that should be immediately obvious in looking at these results? It's not the setting up of the savepoint or the Account list that is leading to any kind of slowdown; this is just how long it takes for Salesforce triggers to process large record sets in 200 increment batches. I tested various other org structures, including those with Duplicate Rules enabled, workflows, validation rules, etc ... while those definitely slow down the resulting insert (Standard duplicate rules for Accounts added nearly 7 seconds to the processing time), the vast majority of the time was simply in creating that many objects. This should give you a good idea, per 10k records, how long it takes at baseline to process records: .0032 seconds per Account. Not too shabby.

## Measuring Eagerly-Evaluated Methods

We'll just update the `AccountHandler` object so that the `beforeInsert` method contains some vanilla processing methods as I had shown earlier:

```java
public override void beforeInsert(List<SObject> newRecords) {
  List<Account> accounts = (List<Account>)newRecords;

  this.trimAccountName(accounts);
  this.formatAccountPhone(accounts);
}

private void trimAccountName(List<Account> accounts) {
  for(Account acc : accounts) {
    acc.Name = acc.Name.normalizeSpace();
  }
}

private void formatAccountPhone(List<Account> accounts) {
  for(Account acc : accounts) {
    this.formatPhone(acc.Phone);
  }
}

private String formatPhoneNumber(String phone) {
  if(phone.length() == 10) {
    return '(' + phone.substring(0, 3) + ') '
        + phone.substring(3, 6) + '-'
        + phone.substring(6);
  } else if (phone.length() == 11 && phone.substring(0) == '1') {
      return this.formatPhoneNumber(
        phone.substring(
          1,
          phone.length() - 1)
      );
  }

  return phone;
}
```

Two simple methods -- let's see how much processing time that consumes:

```bash
Starting execute after gathering sample records, time passed: 0.403 seconds
Ending, time passed: 33.469 seconds
```

That's a 4.47% increase in processing time. With smaller number of records, of course, such increases are hardly noticeable -- until they are. I think anybody who's converted a lead at the start of a greenfield project versus several years into the implementation can attest to the fact (which I have cited previously in the [React.js versus Lightning Web Components post](react-versus-lightning-web/components/)) that delays as small as 50ms can both be detected and negatively impact the end user experience.

## Diving Into Lazy Evaluation

Somebody recently asked a question regarding the performance and organization of Apex triggers as they grow, and possible design patterns for cleaning up complicated handlers. Since it's something I've spent quite a bit of time thinking about as I pondered the `LazyIterator` framework, I directed them to read the [Nebula Consulting post on Lazy Iterators](https://nebulaconsulting.co.uk/insights/list-processing-in-apex/). Their response?

> That seems hard for the next guy to learn, to be honest

They're not wrong. Looking at the [Nebula Bitbucket](https://bitbucket.org/nebulaconsulting/nebula-core/src/master/) shows that a lot has changed since the article was written last year; many updates to the framework, and a lot of potential. But, like FFLib, the issues with larger frameworks lie in stimulating adoption. How can you get new users to grok the intent of your code, particularly with very abstract examples? Documentation helps, but it's not perfect, and as soon as you have documentation, you're in an arms-race with yourself to keep it up-to-date. Typically, frameworks achieve widespread adoption by providing some combination of three things:

- ease of learning
- enhancements on basic functionality
- performance improvements

These tenets hold true for domains outside of programming, of course, but across the tech stack it's easy to see different permutations of this concept:

- logging frameworks get adopted because, despite typically carrying a learning curve, they help to raise the visibility of errors
- immutability frameworks get adopted because they help to prevent hard-to-trace pointer bugs
- fluent frameworks get adopted because they make the code easier to read

In many ways, I'm the ideal consumer of the `LazyIterator` framework -- I'm a consulting company looking to bring performance improvements to my clients, many of whom already deal with routine system slowdown due to growth. How can I wrap the functionality presented by the `LazyIterator` concept into something that's easier for others (including myself) to use and understand? The examples that follow are heavily-influenced by Aidan Harding's work. I re-implemented everything from scratch -- not something that I think is necessary the vast majority of the time, but somethign that I think indeed helps when looking to further your understanding of new concepts.

### Re-implementing A Lazy Iterator

This is a stirling use-case for inner classes. Much like how people got really excited when [IIFE's](https://developer.mozilla.org/en-US/docs/Glossary/IIFE) became a big part of JavaScript development, inner classes allow you to hide the scary parts of your code from other consumers. And, much like IIFE's, they can abused/over-used. They're not always the answer! Another alternative, which is frequently talked about in the book Clean Code, is the Adapter pattern, where you isolate the code foreign to your codebase through the use of interfaces and boundary objects.

Since we're talking about trigger handler frameworks, I am going to tailor the code that follows towards exploring how to achieve lazy iteration in a trigger handler's context. It should be noted that the `LazyIterator` framework covers an enormous swath of material and use-cases; keeping it simple here will help to keep the overall size of what you're reading down to a manageable level.

I'll start "simple", with a wrapped iterator capable of detecting when SObjectFields have changed:

### Implementing A Lazy Filter Function

```java
//separate file for the interface
//because outside callers can
//(and need to) implement
public interface BooleanFunction {
  Boolean isTrueFor(Object o);
}

public class ObjectChangeProcessor {
  private LazyIterator iterator;

//assumes objects are in the same order
//as in Trigger.oldRecord, Trigger.new
  public ObjectChangeProcessor(List<SObject> oldObjects, List<SObject> newObjects) {
    this.iterator = new LazySObjectPairIterator(oldObjects, newObjects);
  }

  public ObjectChangeProcessor filterByChangeInField(SObjectField field) {
    return this.filterByChangeInFields(new List<SObjectField>{ field });
  }

  public ObjectChangeProcessor filterByChangeInFields(List<SObjectField> fields) {
    this.iterator = new LazyFilterIterator(this.iterator, new FieldChangedFilterProcessor(fields));
    return this;
  }

  public ObjectChangeProcessor filter(BooleanFunction function) {
    this.iterator = new LazyFilterIterator(this.iterator, function);
    return this;
  }

  public List<Object> toList(List<Object> toList) {
    return this.iterator.toList(toList);
  }

//BASE LAZY ITERATOR
  virtual class LazyIterator implements Iterator<Object> {
    private final Iterator<Object> iterator;

    public LazyIterator(Iterator<Object> iterator) {
      this.iterator = iterator;
    }

    protected LazyIterator() {
//one of the more fun statements
//made possible by self-implementation ...
      this.iterator = this;
    }

    public virtual Boolean hasNext() {
      return this.iterator.hasNext();
    }

    public virtual Object next() {
      return this.iterator.next();
    }

    public List<Object> toList(List<Object> toList) {
      while(this.hasNext()) {
        toList.add(this.next());
      }
      return toList;
    }
  }

//Wrapped SObject Pair Iterator
  virtual class LazySObjectPairIterator extends LazyIterator {
    private final Iterator<SObject> oldIterator;
    private final Iterator<SObject> newIterator;

    public LazySObjectPairIterator(List<SObject> oldObjects, List<SObject> newObjects) {
      super();
      this.newIterator = newObjects.iterator();
      this.oldIterator = oldObjects.iterator();
    }

//wrapper POJO
  private class SObjectWrapper {
    public final SObject oldRecord, newRecord;
    public SObjectWrapper(SObject oldRecord, SObject newRecord) {
      this.oldRecord = oldRecord;
      this.newRecord = newRecord;
    }
  }

//realistically, you could just do one of
//these, since it's required that
//both lists have the same # of elements
    public override Boolean hasNext() {
      return this.oldIterator.hasNext() &&
        this.newIterator.hasNext();
    }

    public override Object next() {
      return new SObjectWrapper(
        this.oldIterator.next(),
        this.newIterator.next()
      );
    }
  }

//Iterator that allows for filtering ...
  virtual class LazyFilterIterator extends LazyIterator {
    private Object next;
    private final BooleanFunction filter;
    public LazyFilterIterator(LazyIterator iterator, BooleanFunction filter) {
      super(iterator);
      this.filter = filter;
    }

/* NB: the Nebula version uses
another method, "peek()", but for both
terseness and expressiveness, I find this
recursive method more descriptive: hasNext()
peeks values ahead of the current object
in the list for matches, advancing the
internal iterator's place till it
finds the next match or reaches the end.
This is tail-recursive and, as such,
stack safe */
    public override Boolean hasNext() {
      if(super.hasNext()) {
        this.next = super.next();
        return this.filter.isTrueFor(this.next) ? true : this.hasNext();
      }

      return false;
    }

    public override Object next() {
      if(this.next != null && this.next instanceof SObjectWrapper) {
        return ((SObjectWrapper)this.next).newRecord;
      }
      return this.next;
    }
  }

  class FieldChangedFilterProcessor implements BooleanFunction {
    private final List<SObjectField> fields;
    public FieldChangedFilterProcessor(SObjectField field) {
      this(new List<SObjectField>{ field });
    }
    public FieldChangedFilterProcessor(List<SObjectField> fields) {
      this.fields = fields;
    }

    public Boolean isTrueFor(Object obj) {
      SObjectWrapper wrapper = (SObjectWrapper)obj;
      Boolean hasMatch = false;
      Integer counter = 0;
//since the matching variable is also
//what's being returned, I prefer this format
//to the usage of a "break" statement
      while(counter < this.fields.size() && !hasMatch) {
        hasMatch = wrapper.oldRecord == null ||
          wrapper.oldRecord.get(this.fields[counter]) !=
          wrapper.newRecord.get(this.fields[counter]);
        counter++;
      }
      return hasMatch;
    }
  }
}
```

As always, usage of the Decorator pattern means you're looking at a lot more code. However, I've minimized the usage of standalone custom classes in this version, using the `ObjectChangeProcessor` to wrap everything up with a bow. For more generic usages, you probably _wouldn't_ wrap the `LazyIterator` itself. What does all of this code get us? Easy and lazily-implemented detection of records in a trigger that have changed based on field conditions:

```java
private class ObjectChangeProcessorTests {
  @isTest
  static void it_should_correctly_filter_records() {
    Account acc = new Account(
      Name = 'Test Account',
      NumberOfEmployees = 5
    );

    Account newAcc = new Account(
      Name = acc.Name,
      NumberOfEmployees = acc.NumberOfEmployees + 2
    );

    Account accTwo = new Account(
      Name = 'Test Two',
      NumberOfEmployees = 5
    );

    Account accThree = new Account(
      Name = 'Test Three',
      NumberOfEmployees = 6
    );

    Account accThreeNew = new Account(
      Name = accThree.Name,
      NumberOfEmployees = accThree.NumberOfEmployees + 1
    );

    List<SObject> oldObjects = new List<SObject>{ acc, accTwo, accThree } ;
    List<SObject> newObjects = new List<SObject>{ newAcc, accTwo, accThreeNew };

    ObjectChangeProcessor processor = new ObjectChangeProcessor(oldObjects, newObjects);

    List<Account> accounts = (List<Account>)
      processor
        .filterByChangeInField(Account.NumberOfEmployees)
        .toList(new List<Account>());

    System.assertEquals(2, accounts.size());
    System.assertEquals(7, accounts[0].NumberOfEmployees);
    System.assertEquals(7, accounts[1].NumberOfEmployees);
  }
}
```

Writing a test like this -- documentation, in and of itself -- is my preferred method for investigating a foreign object's API. Does it perform like I expect it to? Does it require complicated arguments to setup and maintain? The further you deviate from the SFDC included library for Apex, the harder it is going to be for somebody else to use.

---

When examining the original version of `LazyFilterIterator`'s "hasNext" implementation, Aidan suggested that it might not be stack-safe. Apex allows for a maximum stack depth of 1000 units, and running up against that boundary condition wouldn't be covered by the upcoming `QueueableTimer` tests that you'll see below; because Apex Triggers artificially chunk operations into 200 record increments, it might lead to a false sense of confidence in the code's ability to process large amounts of objects. After tweaking the existing recursive function, I wrote the following test:

```java
//in ObjectChangeProcessorTests.cls
@isTest
static void it_should_not_blow_the_stack_while_filtering() {
  //that oughtta' do it!
  Integer sentinelValue = 10^7;
  List<Account> accounts = new List<Account>();
  for(Integer index = 0; index < sentinelValue; index++) {
    accounts.add(new Account(Name = 'Test ' + index));
  }

  ObjectChangeProcessor processor = new ObjectChangeProcessor(accounts);
  List<Object> sameAccounts = processor
    .filter(new AlwaysTrue())
    .toList(new List<Account>());

  System.assertEquals(sentinelValue, sameAccounts.size());
  System.assert(true, 'Should make it here');
}

class AlwaysTrue implements BooleanFunction {
  public Boolean isTrueFor(Object o) { return true; }
}
```

And the test passed. Joy. As an aside, I typically don't advocate for testing implementation details (the iterator should work the same regardless of the number of records!); that said, on SFDC, it's always advisable to have bulkified tests to verify that you don't exceed your SOQL/SOSL/DML allowances, and assuring that your custom iterator isn't going to blow up on a large data-set certainly falls into this bulkified testing mandate.

### Implementing A Lazy Processor Function

Now I want to move on towards achieving feature parity through the `LazyIterator` with the code shown earlier for the `AccountHandler` object; namely, how can I load the iterator with functions that can act upon the SObjects passed into the trigger. This involves a sad case of boilerplate due to not being able to cast on a `Iterator<SObject>` to `Iterator<Object>`. Let's go back to the `ObjectChangeProcessor`:

```java
public interface Function {
  void call(Object o);
}
```

```java
public class ObjectChangeProcessor {
  private LazyIterator iterator;
  private List<Function> functions;

  public ObjectChangeProcessor(List<SObject> oldObjects, List<SObject> newObjects) {
    this(new LazySObjectPairIterator(oldObjects, newObjects));
  }

/*alas, this constructor leads to the dreaded
"Operation cast is not allowed on type: System.ListIterator<SObject>" error
public ObjectChangeProcessor(List<SObject> records) {
  this((Iterator<Object>)records.iterator());
}*/

  public ObjectChangeProcessor(List<SObject> records) {
    //so we have to do this instead :-\
    this(new LazySObjectIterator(records.iterator()));
  }

  private ObjectChangeProcessor(LazyIterator iterator) {
    this.iterator = iterator;
    this.functions = new List<Function>();
  }

  public ObjectChangeProcessor addFunction(Function func) {
    this.functions.add(func);
    return this;
  }

  public void process() {
    this.iterator.forEach(this.functions);
  }
}
```

And in the iterator inner class:

```java
public LazyIterator forEach(Function func) {
  return this.forEach(new List<Function>{ func });
}
public LazyIterator forEach(List<Function> funcs) {
  while(this.hasNext()) {
//it's iterators all the way down!
    Iterator<Function> funcIterator = funcs.iterator();
    Object nextObject = this.next();
    while(funcIterator.hasNext()) {
      Function func = funcIterator.next();
      func.call(nextObject);
    }
  }
  return this;
}
```

Plus we need to add the `LazySObjectIterator` inner class since casting on the `Iterator` object is not allowed:

```java
virtual class LazySObjectIterator extends LazyIterator {
  private final Iterator<SObject> iterator;
  public LazySObjectIterator(Iterator<SObject> iterator) {
    super();
    this.iterator = iterator;
  }

  public override Boolean hasNext() {
    return this.iterator.hasNext();
  }

  public override Object next() {
    return this.iterator.next();
  }
}
```

Going back to our `AccountHandler` example, it's time to encapsulate the phone/name update methods within classes:

```java
//in AccountHandler.cls
public class AccountHandler extends TriggerHandler {

  public override void beforeInsert(List<SObject> insertedRecords) {
    new ObjectChangeProcessor(insertedRecords)
      .addFunction(new NameNormalizer())
      .addFunction(new PhoneNormalizer())
      .process();
  }

  class NameNormalizer implements Function {
    public void call(Object o) {
      Account acc = (Account)o;
      acc.Name = acc.Name.normalizeSpace();
    }
  }

  class PhoneNormalizer implements Function {
    public void call(Object o) {
      Account acc = (Account)o;
      acc.Phone = this.formatPhoneNumber(
        //strip non-digits
        acc.Phone.replaceAll(
          '[^0-9]',
          ''
        )
      );
    }

  private String formatPhoneNumber(String phone) {
    if(phone.length() == 10) {
          return '(' + phone.substring(0, 3) + ') '
              + phone.substring(3, 6) + '-'
              + phone.substring(6);
      } else if (phone.length() == 11
        && phone.substring(0) == '1') {
          return this.formatPhoneNumber(
            phone.substring(
              1, phone.length() - 1)
          );
      }
      return phone;
    }
  }
}
```

Note that testing the `NameNormalizer` and `PhoneNormalizer` inner classes is easily achievable, and they can also be broken out of the Handler into individual/wrapped classes as their responsibilities increase.

## Measuring Lazy Evaluation

Now that the `AccountHandler` code has been updated, it's finally time to re-run the `QueueableTimer` object to see how lazy iteration stands up, performance-wise. Note, again, that I take the average of many runs when reporting out on performance. In other news, "finally time" turned out to be ~4 hours of writing between the "QueueableTimer" runs -- whoah!

```bash
Starting execute after gathering sample records, time passed: 0.363 seconds
Ending, time passed: 32.416 seconds
```

| Handler Method     | Time    | % Diff | Comments                                  |
| ------------------ | ------- | ------ | ----------------------------------------- |
| Empty              | 32.035s | 0.00%  | Without any logic at all                  |
| Standard for loops | 33.469s | 4.47%  | Two calls to "for" loop iteration methods |
| LazyIterator       | 32.416s | 1.19%  | Two "function" classes added to iterator  |

Plus, the results of the tests in `ObjectChangeProcessorTests`:

| TEST NAME                                    | OUTCOME | RUNTIME (MS) |
| -------------------------------------------- | ------- | ------------ |
| it-should-call-functions-added-to-processor  | Pass    | 16           |
| it-should-correctly-filter-records           | Pass    | 8            |
| it-should-not-blow-the-stack-while-filtering | Pass    | 5            |

I'll take 5ms to iterate 10 million rows, yes please.

In general, I would hasten to say two things regarding the performance of the `LazyIterator` -- both the vanilla `for` loop and Lazy Iterator approach were tested dozens of times and an average of their results were taken. That said, the standard deviation for both approaches is large enough that I would caution taking the results _too_ seriously. While I don't find it hard to believe that relying heavily on the native iterators outperforms the additional cost of initializing objects, neither do I find the performance gain in real terms to be the deciding factor in adopting this framework.

---

## Wrapping Up

Reverse-engineering (an admittedly _extremely small portion of_) the `LazyIterator` proved to be good, clean fun. Like all good exercises, it left me with plenty of inspiration for how to apply the code to my own use-cases. While I had a few nits with the overall level of verbosity, in general I would say that the framework code is both well-annotated with Javadoc descriptions and remarkably expressive at a very high-level of abstraction -- no easy feat. I left impressed, which is my highest praise.

I will definitely be making use of some of the code here and from the Nebula Consulting repo. I like the fluent nature of working with the wrapped iterator; I can also see, with some work, how I would expand upon the structure orchestrated here to accommodate my two other most frequent use-cases:

- iterating through a list with a `Map<Id, Object>` or `Map<String, Object>` that matches a value in that list, and performing processing
- iterating through a list with a `Map<Id, List<Object>>` or `Map<String, List<Object>>` that matches a value in that list, and performing processing

Additionally, there are some fun considerations for the `LazyIterator` -- some of which are handled within the existing Nebula Consulting `LazyIterator` framework, some of which would be excellent additions:

- Allowing you to filter for multiple discrete (not necessarily mutually exclusive, but independent) criteria in a single iteration. This would really help with performing additional processing on subsets of data depending on different field changes / entry conditions _without_ unnecessary iteration. You could definitely finangle this into an existing `Function` definition, but really you would be looking for a combination of the existing `Function` and `BooleanFunction` implementations, where all matches were tested for and, conditionally, processing was done if the result matched. Of course, depending on your business logic, there definitely exists the potential for independent updates to depend on one another in some happy temporal soup. Traditionally, showing that the order of functions being called matters makes use of explicit passing of variables to the further-down-the-line functions to make the coupling explicit. With a fluent iterator, another approach would be necessary; in looking again at the Nebula Repo, their `ForkIterator` _does_ handle the first use-case (independent filtering), but massaging the API to better broadcast dependent forking is only a dream at the moment
- proper support for empty iterators (clasically, the use of a singleton "null" instance is used; a singleton because you only ever need one instance of it) -- I've been promised a framework-wide approach using their `EmptyIterator` object is forthcoming!
- first class support for Maps, as discussed above. Ideally the `LazyIterator` would be able to both build a one-to-one (`Map<Id, Object>` or `Map<String, Object>`) or one-to-many (`Map<Id, List<Object>>` or `Map<String, List<Object>>`) collection as part of a `Function` _and_ pass the results to future `Function`s for usage. Unfortunately, while casting is a "pain" with Lists, it's not even allowed with Maps in Apex, which would probably necessitate painful (and limiting) serialization/deserialization techniques (which has actual performance implications, as well)

As always, I hope that this post proved illuminating -- if not on the seemingly endless iteration topic, then at least in having walked this road with me for some time. It's always appreciated.

Till next time!
