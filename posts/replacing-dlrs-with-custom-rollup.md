> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Replacing DLRS With Custom Rollup

> :Author src=github,date=2020-12-31T15:00:00.000Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

A few months ago I was tasked with replacing Declarative Lookup Rollup Summaries (DLRS) in an org suffering from frequent deadlocks. Rollup summary fields in Salesforce are plagued by severe limitations -- only being available on master-detail relationships being <a href="#custom-rollup-use-cases">just the start of the list.</a> When faced with implementing custom rollups, most people go with DLRS because it's free. Performance in the org inevitably suffers.

Read on to learn about how I built `Rollup`, complete with elastic scaling (go fast when you need to, slow when there are more rollups to process), to assist in orgs looking for DLRS-like flexibility with a much smaller performance overhead.

Discover how the "Google Analytics" approach to implementing rollups in your Salesforce org gives you the flexibility and power that you need - install with:

- <a href="#one-line-of-code"> _one line of code_</a> in any trigger
- no code at all, <a href="#from-flow">using Custom Metadata and an Invocable method</a>
- the SOQL query of your choice (pre-tested to ensure it runs) on the schedule of your choosing

**OR** opt-into truly powerful code-based hooks that allow you to perform custom-based filtering using a simple `Evaluator` interface.

Keep reading, or [check out the repository Readme for more](https://github.com/jamessimone/apex-rollup/)!

<h2 id="custom-rollup-use-cases">Use Cases For Custom Rollups</h2>

Let's look at some of the problem areas experienced when implementing rollup fields:

- We want to rollup values from one lookup relationship to another related object
- We want to rollup based on criteria on the "parent" record, or perhaps even criteria on another related record
- We want to rollup to different fields based on the filtering criteria we've defined (fields like `TotalOfGroupA__c` and `TotalOfGroupB__c`)
- We need to data-fix existing rows to have the correct calculations
- We want to rollup values that are unsupported (Opportunity Close Date can be MIN/MAX'd ... but not Task Activity Date?? Who wrote this manual?!)
- We have fields on a related object that can by synthesized to form a value matching that of another field/fields on another object, and using formula fields to create a "key" field would lead to bad performance

The list could go on and on. None of these use cases are supported with out-of-the-box Salesforce. You can see in many areas of the platform that providing developers with ways to augment the existing behavior for out-of-the-box features leads to awesome customizations. With rollups, we don't have the ability through the UI to specify something like an overriding Apex class; we have no interface to implement. No -- if we want something better, we have to build it ourselves.

## Introducing Rollup

With the stage set and the problem well-defined, let's take a look at the beginnings of the `Rollup` project by examining how to invoke it from within a Trigger Handler class:

```java
// within the "MyCustomObject__c" trigger handler

// I'm aware it's not the sexiest interface. Keeping track of which field is which
// is now engraved in my head, but I'll annotate for now
// I expect most people will be using CMDT to manage these fields, anyway

RollupCalculator.sumFromTrigger( // the rollup operation
  MyCustomObject__c.Amount__c, // the field that will inform the rollup
  MyCustomObject__c.OwnerId, // the field on MyCustomObject related to the next argument, the matching field on the related object
  User.Id, // the matching field on the object where the rollup will be performed
  User.TotalCustomAmount__c, // the field where the rollup will be written to
  new IsFlaggedBySalesUser(), // optional - a way to filter the "newCustomObjects" for ones that match
  User.SObjectType // the related object where the rollup will be informed
);

private class IsFlaggedBySalesUser implements Rollup.Evaluator {
  public Boolean matches(Object calcItem) {
    MyCustomObject__c customObj = (MyCustomObject__c)calcItem;
    return customObj.IsFlaggedBySalesUser__c;
  }
}
```

In order to create something within Apex that can capture _everything_ necessary for performing rollups in a generic way, many arguments are required. You _could_ get rid of that last argument -- the `SObjectType` -- but, sadly, there is no method on the existing [DescribeFieldResult class](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_methods_system_fields_describe.htm#apex_methods_system_fields_describe) that points to the object it was initialized from.

### Getting The SObjectType From An SObjectField

There is a workaround that's been floating around the Salesforce Stack Exchange for several years:

```java
public static SObjectType getSObjectType(Schema.SObjectField field) {
  // This is a solution that was proposed on the Salesforce stack exchange
  // and is the only work-around to a native lookup
  // that I have been able to find.
  Integer fieldHash = ((Object)field).hashCode();

  // Build a map of hashcodes for each fieldDescribe token
  Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();
  Map<Integer,Schema.SObjectType> fieldHashCodeToSObjectTypeMap = new Map<Integer,Schema.SObjectType>();
  for (String sobjname: globalDescribe.keySet()) {
    for (Schema.SObjectField sobjField : globalDescribe.get(sObjName).getDescribe().fields.getMap().values())
      fieldHashCodeToSObjectTypeMap.put(((Object) sObjField).hashCode(), globalDescribe.get(sobjName));
  }

  // hard to believe it, but this actually works! it's a testament to the Describe objects, really:
  // it means that any SObjectField token is a singleton! still, I would NEVER use this in production-level code
  return fieldHashCodeToSObjectTypeMap.get(fieldHash);
}
```

Yikes. While that _works_, it falls down when you want to further generalize; it only works with strongly-typed `SObjectField`s; while the use of `SObjectField` types is a great experience for the developer, they too have shortcomings -- like not supporting parent or child relationships. While it's perfectly valid, using the `MyCustomObject__c` SObject from above, to reference `MyCustomOject__c.Owner.Name`, for example, you cannot construct an `SObjectField` to represent that relationship. Likewise with child relationships. The solution to replace DLRS will need strong ties into an easy-to-use invocable method, and sadly `SObjectField` is not yet supported as an argument type for Invocable Apex actions.

Additionally, a note on design -- after even the briefest of forays into the DLRS codebase had me clawing at my eyes, I made the decision to _only use one class_ (and a test class). Isolating the mechanics of the rollups solely within the `Rollup` class would mean striking a delicate balance between creating a "god class" and adhering to the Single Responsibility Principle.

Shortcomings aside, the core code in `Rollup` is worth examining -- let's go deeper.

### Implementing Rollups In Apex

Without further ado, let's look at some of the key methods in the initial version of `Rollup`:

```java
// in Rollup
// AVG, MAX, MIN, COUNT operations not yet implemented
// because SUM was the only initial ask
private enum Op {
  SUM,
  UPDATE_SUM,
  DELETE_SUM
}

// for really powerful up-front filtering of which items
// are rolled up, supplying an implementation of the Evaluator
// interface does the trick nicely
public interface Evaluator {
  Boolean matches(Object calcItem);
}

// refer to the "IsFlaggedBySalesUser" example above
private static List<SObject> filter(List<SObject> calcItems, Evaluator eval) {
  List<SObject> applicableItems = new List<SObject>();
  for(SObject calcItem : calcItems) {
    if(eval != null && eval.matches(calcItem)) {
      applicableItems.add(calcItem);
    }
  }
  return applicableItems;
}

// key the SObjects passed in to the String value
// matching the key on the object where the rollup
// will be performed
private Map<String, List<SObject>> getCalcItemsByLookupField() {
  Map<String, List<SObject>> lookupFieldToCalcItems = new Map<String, List<SObject>>();
  for(SObject calcItem : this.calcItems) {
    String key = (String)calcItem.get(this.lookupFieldOnCalcItem);
    if(lookupFieldToCalcItems.containsKey(key) == false) {
      lookupFieldToCalcItems.put(key, new List<SObject>{ calcItem };
    } else {
      lookupFieldToCalcItems.get(key).add(calcItem);
    }
  }
  return lookupFieldToCalcItems;
}

// your garden-variety dynamic SOQL
private List<SObject> getLookupItems(Set<String> objIds) {
  String queryString =
    'SELECT Id, ' + this.lookupObjOpField.getDescribe().getName() +
    '\nFROM ' + this.lookupObj.getDescribe().getName() +
    '\nWHERE ' + this.lookupField.getDescribe().getName() + ' = :objIds';
  return Database.query(queryString);
}

// the meat of the Rollup
private void performRollup(Map<String, List<SObject>> calcItemsByLookupField, List<SObject> lookupItems) {
  List<SObject> toUpdate = new List<SObject>();
  for(SObject lookupRecord : lookupItems) {
    String key = (String)lookupRecord.get(this.lookupField);
    if(calcItemsByLookupField.containsKey(key) == false) {
      continue;
    }

    List<SObject> calcItems = calcItemsByLookupField.get(key);
    Object priorVal = lookupRecord.get(this.lookupObjOpField);
    Object newVal = this.getRollupVal(calcItems, priorVal);
    lookupRecord.put(this.lookupObjOpField, newVal);
    toUpdate.add(lookupRecord);
  }

  update toUpdate;
}

// right now, this "works" - but we'll need to further generalize
// to support other kinds of rollup operations
private Object getRollupVal(List<SObject> calcItems, Object priorVal) {
  Decimal returnVal = priorVal == null ? 0 : (Decimal)priorVal;
  for(SObject calcItem : calcItems) {
    switch on this.op {
      when SUM {
        returnVal += (Decimal)calcItem.get(this.opField);
      }
      when DELETE_SUM {
        returnVal -= (Decimal)calcItem.get(this.opField);
      }
      when UPDATE_SUM {
        Decimal oldVal = (Decimal)this.oldCalcItems.get(calcItem.Id).get(this.opField);
        Decimal newVal = (Decimal)calcItem.get(this.opField);
        returnVal += (newVal - oldVal); // could be negative, could be positive
      }
      when else {
        throw new IllegalArgumentException('Other rollup op: ' + this.op.name() + ' not yet implemented');
      }
    }
  }
  return returnVal;
}
```

The framework for rolling values up appears fairly quickly; this isn't really even that many lines of code. Indeed, the rest of the `Rollup` is largely defined by constructors at this point, and static methods exposing the rollup operations.

## Reduce, Reuse, Refactor: Rollup, Part Two

First things first -- that `getRollupVal` method needs to decouple itself from the type of rollup being performed. This is a great use-case for inner classes:

```java
private Object getRollupVal(RollupCalculator calc, List<SObject> calcItems, Object priorVal) {
  Rollup rollup = this.getRollupType(priorVal);
  for (SObject calcItem : calcItems) {
    rollup.performRollup(calc.op, priorVal, calcItem, calc.oldCalcItems, calc.opField.getDescribe().getName());
  }
  return rollup.getReturnValue();
}

private Rollup getRollupType(Object priorVal) {
  // fun fact - integers, doubles, longs, and decimals
  // will ALL return true here
  if (priorVal instanceof Decimal) {
    return new DecimalRollup(priorVal);
  } else {
    throw new IllegalArgumentException('Rollup operation not defined for: ' + JSON.serialize(priorVal));
  }
}

private abstract class Rollup {
  protected Object returnVal;
  public Rollup(Object returnVal) {
    this.returnVal = returnVal;
  }
  public Object getReturnValue() {
    return returnVal;
  }
  public abstract void performRollup(Op op, Object priorVal, SObject calcItem, Map<Id, SObject> oldCalcItems, String operationField);
}

private class DecimalRollup extends Rollup {
  public DecimalRollup(Object priorVal) {
    super(priorVal == null ? 0 : priorVal);
  }

  public override void performRollup(Op operation, Object priorVal, SObject calcItem, Map<Id, SObject> oldCalcItems, String operationField) {
    Decimal returnVal = (Decimal) this.returnVal;
    switch on operation {
      when SUM {
        returnVal += (Decimal) calcItem.get(operationField);
      }
      when DELETE_SUM {
        returnVal -= (Decimal) calcItem.get(operationField);
      }
      when UPDATE_SUM {
        Decimal oldVal = (Decimal) oldCalcItems.get(calcItem.Id).get(operationField);
        Decimal newVal = (Decimal) calcItem.get(operationField);
        returnVal += (newVal - oldVal); // could be negative, could be positive
      }
      when else {
        throw new IllegalArgumentException('Other rollup op: ' + operation.name() + ' not yet implemented');
      }
    }
  }
}
```

If you're looking at `getRollupType` in the above example and thinking that it looks like the [Factory pattern](/dependency-injection-factory-pattern), that's a bingo! Now the _type_ of rollup being performed has been decoupled from the logic necessary to perform the actual rollup. That makes it easy to add in:

- new rollup types
- the behavior for rollups based on the `Op` enum (currently just SUM, but we'll expand on that shortly)

A potential code smell (perhaps obscured by only having one rollup operation defined) is the `switch` statement in `DecimalRollup`. This piece of logic will have to be replicated in each `Rollup` inner class prior to us being able to proceed. However, with a slight shift in perspective comes an object-oriented opportunity to reduce the boilerplate necessary to introduce new rollup types into the mix:

```java
// in Rollup.cls
private enum Op {
  SUM,
  UPDATE_SUM,
  DELETE_SUM,
  COUNT, // our first new operation!
  UPDATE_COUNT,
  DELETE_COUNT
}

private Rollup getRollupType(Object priorVal, Op operationType) {
  // have to use the fully qualified Op name here (including the outer class)
  // since its type is shadowed in this method
  if(operationType.name().contains(RollupCalculator.Op.COUNT.name())) {
    return new CountRollup(priorVal);
  } else if (priorVal instanceof Decimal) {
    return new DecimalRollup(priorVal);
  } else {
    throw new IllegalArgumentException('Rollup operation not defined for: ' + JSON.serialize(priorVal));
  }
}

private abstract class Rollup {
  protected Object returnVal;
  public Rollup(Object returnVal) {
    this.returnVal = returnVal;
  }
  // we make this virtual to deal with downcasting
  public virtual Object getReturnValue() {
    return returnVal;
  }
  public abstract void performRollup(Op op, Object priorVal, SObject calcItem, Map<Id, SObject> oldCalcItems, SObjectField operationField);
}

private virtual class DecimalRollup extends Rollup {
  public DecimalRollup(Object priorVal) {
    // much as it pains me to duplicate the null check, it must be done;
    // we can't reference instance methods till after the super() call
    super(priorVal == null ? 0 : priorVal);
  }

  protected Decimal getDecimalOrDefault(Object potentiallyUnitializedDecimal) {
    return (Decimal) (potentiallyUnitializedDecimal == null ? 0 : potentiallyUnitializedDecimal);
  }

  protected virtual Decimal getNumericValue(SObject calcItem, SObjectField operationField) {
    return this.getDecimalOrDefault(calcItem.get(operationField));
  }

  protected virtual Decimal getNumericChangedValue(SObject calcItem, SObjectfield operationField, Map<Id, SObject> oldCalcItems) {
    Decimal newVal = this.getNumericValue(calcItem, operationField);
    Decimal oldVal = this.getNumericValue(oldCalcItems.get(calcItem.Id), operationField);
    // could be negative, could be positive ... could be 0!
    return newVal - oldVal;
  }

  public override void performRollup(Op operation, Object priorVal, SObject calcItem, Map<Id, SObject> oldCalcItems, SObjectField operationField) {
    Decimal returnVal = (Decimal) this.returnVal;
    switch on operation {
      when SUM, COUNT {
        returnVal += this.getNumericValue(calcItem, operationField);
      }
      when DELETE_SUM, DELETE_COUNT {
        returnVal -= this.getNumericValue(calcItem, operationField);
      }
      when UPDATE_SUM, UPDATE_COUNT {
        returnVal += this.getNumericChangedValue(calcItem, operationField, oldCalcItems);
      }
      when else {
        throw new IllegalArgumentException('Other rollup op: ' + operation.name() + ' not yet implemented');
      }
    }
  }
}

private class CountRollup extends DecimalRollup {
  public CountRollup(Object priorVal) {
    super(priorVal);
  }

  public override Object getReturnValue() {
    return (Integer) this.returnVal;
  }

  protected override Decimal getNumericValue(SObject calcItem, SObjectField operationField) {
    Decimal potentialReturnValue = super.getNumericValue(calcItem, operationField);
    return this.getCountValue(potentialReturnValue);
  }

  protected override Decimal getNumericChangedValue(SObject calcItem, SObjectField operationField,
    Map<Id, SObject> oldCalcItems) {
    Decimal potentialReturnValue = super.getNumericChangedValue(calcItem, operationField, oldCalcItems);
    return this.getCountValue(potentialReturnValue);
  }

  private Decimal getCountValue(Decimal potentialReturnValue) {
    return potentialReturnValue > 0 ? 1 : potentialReturnValue;
  }
}
```

Et voila -- in just a few short lines and an additional check in the factory method, we've added a completely different rollup type into the mix. The new `CountRollup` class has an interesting condition to it (consistent with the rules for how the `COUNT` function works in SOQL) -- it still requires there to be a non-null value on the field within the calculation item that it's comparing to. It may be the case that people simply want to count all child/related objects and roll up their presence to a parent/related object. I'll be curious to hear from you as to whether or not that functionality is desired, prior to implementing a so-called `BlindCount` version.

As I added more functionality, it occurred to me that either by wanting to perform many rollups from within a single trigger, or by having rollup operations involving large amounts of records, it might be possible to creep towards the synchronous DML limit of 10,000 DML rows in a single transaction. Making `Rollup` perform the bulk of the work async also led to implementing the [Data Processor](/batchable-and-queueable-apex) pattern -- by burning a few SOQL queries on the synchronous side, `Rollup` can automatically (or through the use of `RollupLimit__mdt` custom metadata) scale from running as a Queueable to a Batchable as the size of rollup operations grow. This is the power of elastic scaling!

---

## Rollup - A Note On Progress

<div style="display: inline">I wrote the above paragraph on December 21st, and jotted down a note to myself:</div> <div style="background-color: orange; color: white; display: inline;">TODO:</div> max/min ??.
<br/>
<br/>

Today is December 29th. It's not that I took a break from writing this article; I didn't. What happened? Over the hours (and then days) that followed, I began to add additional operations for `Rollup`. My assumption -- with the SUM operations for numbers basically "complete" -- surrounding the ease of implementing the rest of the rollup functions slowly began to wither on the vine. I laughed on Christmas [when a stranger submitted a PR on one of my open-source repos](https://github.com/jamessimone/gatsby-remark-footnotes/pull/6) -- one thing I was no stranger to was putting in long hours on passion projects, and somebody else was clearly taking advantage of the holidays.

What began as a casual foray into adding `COUNT` quickly began to escalate outwards as the code smell that I mentioned earlier -- the `switch` statement in `DecimalRollup` became bigger and bigger.

> "This isn't really even that many lines of code" - a younger, more naive version of me (earlier in this article), before the `switch` statement in `DecimalRollup` ended up as 50% of the size of the entire `Rollup` class when I started

The addition of an Invocable entry point for Flows and Process Builders contributed to the rising tide of lines of code -- and at the end of that journey, without many of the rollup functions even implemented yet, I realized it was **past time** ... the tests needed to be ported over, and new ones created ASAP to ensure what I had so far was going to work.

### Design Decisions For Testing The Rollup Framework

If you've read [The Joys Of Apex](/) before, you know that keeping your Salesforce tests running quickly is something I'm passionate about. This was doubly important in the current context: the tests I'd originally written were tightly coupled to two things that weren't going to make the cut:

- custom fields on standard SObjects; a no-no for any open source library
- having a trigger handler framework / pre-existing entry point into the code

One of the reasons that DLRS is so big as a codebase is because it imports a ton of code from FFLib to perform the metadata deployments necessary to create DLRS triggers/rollups as needed. It occurred to me that I was trying to encourage something more along the lines of adding an analytics tag to a website than the sort of service DLRS offerred: I've worked on several analytics implementations, and vetted many vendors. I've never heard of somebody offering a service that _didn't_ require the installation of a JavaScript / backend SDK in order to work (even Cloudflare and other reverse proxy services require up-front configuration). In other words, as I considered how I wanted my tests to work, I had to also solidify the concepts (like `Rollup` being more akin to installing Google Analytics) necessary for `Rollup` to be used.

Since my prior tests were a no-go, I found myself recalling the immortal words of Kent Beck in "Test Driven Development By Example":

> You will often be implementing TDD in code that doesn't have adequate tests. When you don't have enough tests, you are bound to come across refactorings that aren't supported by tests ... what do you do? Write the tests you wish you had.

In order to make the tests run fast, I needed to limit the amount of DML performed. Crucial to that effort would be the following class and seam:

```java
// in Rollup.cls
@testVisible
private virtual class DMLHelper {
  public virtual void doUpdate(List<SObject> recordsToUpdate) {
    update recordsToUpdate;
  }
}

/**
  * receiving an interface/subclass from a property get/set (from the book "The Art Of Unit Testing") is an old technique;
  * useful in limited contexts to get around the classic approach to dependency injection
  * (such as in this case, when constructor-based DI isn't possible).
  * It's more palatable in Apex than in many other languages, as a matter of fact -
  * this is because the @testVisible annotation enforces for us the override only being possible while testing
  */
@testVisible
private static DMLHelper DML {
  get {
    if (DML == null) {
      DML = new DMLHelper();
    }
    return DML;
  }
  set;
}

// and then in the tests:

private class DMLMock extends Rollup.DMLHelper {
  public List<SObject> Records = new List<SObject>();
  public override void doUpdate(List<SObject> recordsToUpdate) {
    this.Records = recordsToUpdate;
  }
}
```

Wait a minute. [Doesn't this look familiar](/mocking-dml)? It should. But because I was intent on keeping everything within one class, I couldn't import dependencies -- I either needed to recreate them inside of the `Rollup` class, or do without them. The [Factory pattern for dependency injection](/dependency-injection-factory-pattern) _and_ the [Repository pattern for strongly-typed and easily mocked queries](/repository-pattern) were both discarded as a result. That left me with the DML Mock pattern -- and sure enough, all of the tests are lightning-fast as a result. Here's a simple one:

```java
// in RollupTests.cls
@isTest
static void shouldSumFromTriggerAfterInsert() {
  DMLMock mock = getMock(new List<Opportunity>{ new Opportunity(Amount = 25), new Opportunity(Amount = 25) });
  Rollup.triggerContext = TriggerOperation.AFTER_INSERT;

  Rollup rollup = Rollup.sumFromTrigger(
    Opportunity.Amount,
    Opportunity.AccountId,
    Account.Id,
    Account.AnnualRevenue,
    Account.SObjectType
  );

  System.assertEquals(true, mock.Records.isEmpty());

  Test.startTest();
  rollup.runCalc();
  Test.stopTest();

  System.assertEquals(1, mock.Records.size(), 'Records should have been populated SUM AFTER_INSERT');
  Account updatedAcc = (Account) mock.Records[0];
  System.assertEquals(50, updatedAcc.AnnualRevenue, 'SUM AFTER_INSERT should add the original opportunity amount');
}
```

One hidden side-effect is the tying of the Opportunities to the Account in question - that happens in the `getMock` method:

```java
// in RollupTests.cls
private static DMLMock getMock(List<SObject> records) {
  Account acc = [SELECT Id FROM Account];
  for (SObject record : records) {
    record.put('AccountId', acc.Id);
  }

  return loadMock(records);
}

// ...

private static DMLMock loadMock(List<SObject> records) {
  Rollup.records = records;
  Rollup.shouldRun = true;
  DMLMock mock = new DMLMock();
  Rollup.DML = mock;

  return mock;
}
```

There are, in fact, only three other helper methods (non test methods) in the entire test class. Once I had tests that covered the basics of what I'd written for the `SUM` and `COUNT` implementations, it was time to approach this thing TDD-style:

- write a failing test
- write enough production-level code to get the test to pass
- refactor

This simple rhythm helped me to immediately spot a flaw in the code for the Invocable method as I worked to create tests for this new functionality -- it was being fed into a method that used the current Trigger context (the `TriggerOperation` enum) to figure out what kind of rollup operation was being performed. That's also where the `Rollup.records` variable came from in the `loadMock` code, above; a way to stub in the trigger records without actually having to require a trigger being run.

When you look at the first ~20 lines of `Rollup`, you can see the use of these `@testVisible` private static variables as the "poor man's dependency injection:"

```java
  /**
   * Test override / bookkeeping section. Normally I would do this through dependency injection,
   * but this keeps things much simpler
   */
  @testVisible
  private static Boolean shouldRun;
  @testVisible
  private static Boolean shouldRunAsBatch = false;
  @testVisible
  private static TriggerOperation triggerContext = Trigger.operationType;
  @testVisible
  private static Map<Id, SObject> oldRecordsMap;
  @testVisible
  private static List<Rollup__mdt> rollupMetadata;
  @testVisible
  private static List<SObject> queryRecords;
  @testVisible
  private static RollupLimit__mdt defaultRollupLimit;
  @testVisible
  private static RollupLimit__mdt specificRollupLimit;
```

There are some juicy hints, above, of what was ultimately to come.

## Adding Custom Metadata-driven Rollups

Adding the CMDT-record driven rollups was simple now that I had a burgeoning test suite and two different possible points of entry (Invocable / Trigger-based) into `Rollup`. Indeed, because the test suite was expansive and I believe that CMDT rollups form the core of peoples' rollup needs, refactoring the code to support custom metadata as a first-class citizen became (truly) a joy. You can tell that the code is really built around it because there are only 3 lines of code in the public-facing method:

```java
// in Rollup.cls - don't mind that null argument below, it's for the custom Evaluator interface
public static void runFromTrigger() {
  SObjectType sObjectType = getTriggerRecords().getSObjectType();
  List<Rollup__mdt> rollupMetadata = getTriggerRollupMetadata(sObjectType);
  runFromTrigger(rollupMetadata, null).runCalc();
}
```

<br/>
<div style="display: inline;" id="one-line-of-code">

</div>

This is the "Google Analytics" approach: in order to use `Rollup`, all you need to do is add _one line of code to your triggers_:

```java
Rollup.runFromTrigger();
```

Unless you need a ton of customization, it's really as simple as that. **Please note**: this _requires_ your trigger to use the following contexts: after insert, after update, and before delete. Without those in place, `Rollup` will not function as designed for trigger-based rollups!

The rest of the info -- about which rollups need to be processed for the trigger in question -- can all live in the `Rollup__mdt` Custom Metadata:

- Label: you can name your metadata records as you please
- Rollup Name: defaults to an underscore version of the Label; again, you can choose this as you will.
- Calc Item: the name of the SObject where the trigger is running. This is an Entity Definition field, so you can only select from available SObjects via a dropdown list.
- Rollup Field On Calc Item: the field you'd like to aggregate. This is a Field Definition field; you can only select from the list of available fields after having made an object-level selection for `Calc Item`
- Lookup Field On Calc Item: the field storing the Id or String referencing a unique value on another object. This is a Field Definition field; you can only select from the list of available fields after having made an object-level selection for `Calc Item`
- Lookup Object: the name of the SObject you'd like to roll the values up to. This is an Entity Definition field, so you can only select from available SObjects via a dropdown list.
- Lookup Field On Lookup Object: the field storing the Id or String referencing the `Lookup Field On Calc Item` on your lookup object. This is a Field Definition field; you can only select from the list of available fields after having made an object-level selection for `Lookup Object`
- Rollup Field On Lookup Object: the field on the lookup object where the rolled-up values will be stored. This is a Field Definition field; you can only select from the list of available fields after having made an object-level selection for `Lookup Object`
- Rollup Type: SUM / MIN / MAX / AVERAGE / COUNT / COUNT_DISTINCT
- Changed Fields On Calc Item: comma-separated list of field API Names (optional) to filter items from being used in the rollup calculations unless all the stipulated fields have changed

There are some peculiarities within Apex when working with Entity Definition and Field Definition-based Custom Metadata fields, which I will detail just below in the key takeaways section!

## Invoking Rollup.cls From A Process Builder / Flow

<div id="from-flow">Invoking the `Rollup` process from a Flow, in particular, is a joy; with a Record Triggered Flow, you can do the up-front processing to take in only the records you need, and then dispatch the rollup operation to the `Rollup` invocable:</div>

![Example flow](./img/joys-of-apex-rollup-flow.png "Fun and easy rollups from Flows")

This is also the preferred method for scheduling; while I do expose the option to schedule a rollup from Apex, I find the ease of use in creating Scheduled Flows in conjunction with the deep power of properly configured Invocables to be much more scalable than the "Scheduled Jobs" of old. This also gives you the chance to do some truly crazy rollups -- be it from a Scheduled Flow, an Autolaunched Flow, or a Platform Event-Triggered Flow. As long as you can manipulate data to correspond to the shape of an existing SObject's fields, they don't even have to exist; you could have an Autolaunched flow rolling up records when invoked from a REST API so long as the data you're consuming contains a String/Id matching something on the "parent" rollup object.

## Key Takeaways In Replacing DLRS

There were quite a few learning moments as I worked through rollup edge cases; I've chosen to spend the rest of this article articulating ones that I think might be helpful or interesting to you in your own Salesforce journey:

### Entity Definition & Field Definition Custom Metadata Relationships Can Be Tricky

There's not a whole lot of documentation out there about Entity / Field Definition-basd CMDT. They _are_ as good as they sound -- giving users of your CMDT object-level and field-level safety when letting them select fields, but something interesting that I found while working with Field Definition fields in Apex is that they are stored as "ObjectName.FieldName" in the database. This roughly corresponds to a string-level representation of what an `SObjectField` type is _written_ as:

```java
// if we query for the Rollup__mdt shown earlier
Rollup__mdt rollupMetadata = [SELECT RollupFieldOnLookupObject__c FROM Rollup__mdt LIMIT 1];
System.debug(rollupMetadata.RollupFieldOnLookupObject__c); // outputs "Opportunity.Amount", for example
SObjectField opportunityAmount = Opportunity.Amount;
System.debug(opportunityAmount); // ouputs ... "Amount" ... so you know that somebody overrode the "toString()" method for this class!
```

When working with dynamic fields in SOQL, developers frequently use the `DescribeSObjectResult` and `DescribeFieldResult` classes that give you access to metadata about objects/fields ... but in this case, I found I had to create a helper method specifically for working with the String-based version of the Field Definition values coming in from the `Rollup__mdt` records:

```java
// takes a string from CMDT like "Opportunity.Amount" and returns just the field name: "Amount"
// this allows us to match the String-based version of the field with its corresponding SObjectField
// by calling describeForSObject.fields.getMap().get(theFieldNameReturnedFromgetParedFieldName)
private static String getParedFieldName(String fullFieldName, DescribeSObjectResult describeForSObject) {
  return String.isBlank(fullFieldName) ? '' : fullFieldName.replace(describeForSObject.getName() + '.', '');
}
```

### Using Enums Is Great, But Instantiating Them From Strings Isn't Obvious

You might remember from the [Apex Enum Class Gotchas](/blog/joys-of-apex/) article that sending the `name()` value for an enum is the only way to properly deserialize the enum when you're ingesting data either in Apex or in another service. That's all well and good -- but, as it turns out, you can't deserialize directly to the String-based enum:

```java
// in Rollup.cls - making this a public enum doesn't change the result
private enum Op {
  SUM,
  UPDATE_SUM,
  DELETE_SUM
  // etc
}

Rollup__mdt rollupMetadata = methodWhereWeGetTheMetadata();
// this is a crazy thing and I wouldn't have wanted to do it anyway, but science ...
// if you ACTUALLY need to do these things from within Apex, I highly recommend the use of the JSONGenerator class
String operationFromMetadata = '{ "op" : "' + rollupMetadata.RollupType__c + '"}';
Op operation = (Op)JSON.deserialize(operationFromMetadata, Op.class);
System.debug(operation);
// outputs null

// you COULD make a wrapper class
private class OpWrapper {
  public Op op { get; set; }
}
OpWrapper opWrapper = (OpWrapper)JSON.deserialize(operationFromMetadata, OpWrapper.class);
System.debug(opWrapper);
// outputs: "OpWrapper:[Op=SUM]", for example
```

Keying the string from the CMDT to be valid JSON _and_ creating a wrapper class left me feeling a little ill, so instead I went with a lazily-loaded `Map<String, Op>` using the included `values()` method present on all enums:

```java
private static Map<String, Op> opNameToOp {
  get {
    if (opNameToOp == null) {
      opNameToOp = new Map<String, Op>();
      for (Op operation : Op.values()) {
        opNameToOp.put(operation.name(), operation);
      }
    }
    return opNameToOp;
  }
  set;
}
```

It's not perfect, but it's better than crafting JSON to get around not being able to cast from a String to an enum, and not being able to reference the enum by its `name()` in any other way.

### Not all fields of the same type in Salesforce support MIN or MAX operations

This is probably true of other field types (honestly, at this point, nothing would really surprise me), but it came up frequently for me while testing with `Date` / `Datetime` fields, as well as multi-select picklists (the Devil's picklists, some would say).

It _did_ come as a real surprise to me as I was writing tests; I had used only the Account and Opportunity objects so far in my tests, in an effort to keep them as generic as possible. I wanted to write a test using a `Date` field that _wasn't_ required on insert to test my `DefaultFieldInitializer` (more on that in a second). While you can `MIN` or `MAX` the Opportunity's `CloseDate` field, the "parent" object I had been using as the target of my rollups, Account, didn't have a `Date` field on it. In retrospect, I could have used the Contract object (and later I would), but I'm glad I didn't, as I might not have encountered this charming error message otherwise: `System.QueryException: There's a problem with your query: field ActivityDate does not support aggregate operator MAX`. Uhhh, OK. Thanks for that, Salesforce.

Wherever possible, I've tried to make the code resilient to the idiosyncracies of the platform; for operations like this, if that means doing the damn `MIN` / `MAX` myself, so be it:

```java
// MIN/MAX is allowed, but not for all fields, and not consistently. Go figure!
protected virtual override Object calculateNewAggregateValue(Set<Id> excludedItems, Op operation, SObjectField operationField, SObjectType sObjectType) {
  Object aggregate;
  try {
    aggregate = super.calculateNewAggregateValue(excludedItems, operation, operationField, sObjectType);
  } catch (Exception ex) {
    // technically a System.QueryException, but I figure we might as well catch em all and try like hell to aggregate anyway
    Decimal minOrMax;
    List<SObject> allOtherItems = Database.query('SELECT ' + operationField + ' FROM ' + sObjectType + ' WHERE Id != :excludedItems');
    for (SObject otherItem : allOtherItems) {
      Decimal otherItemDate = this.getDecimalOrDefault(otherItem.get(operationField));
      if (otherItemDate != null && operation.name().contains(Op.MAX.name()) && (minOrMax == null || otherItemDate > minOrMax)) {
        minOrMax = otherItemDate;
      } else if (otherItemDate != null && operation.name().contains(Op.MIN.name()) && (minOrMax == null || otherItemDate < minOrMax)) {
        minOrMax = otherItemDate;
      }
    }
    if (minOrMax == null) {
      aggregate = operation.name().contains(Op.MIN.name()) ? FieldInitializer.maximumLongValue : FieldInitializer.minimumLongValue;
    } else {
      aggregate = minOrMax;
    }
  }

  return aggregate;
}
// not pictured - the "hot as hell" section where min/max gets tabulated for multi-select picklists. Yowza! Feel the burn!
```

### Null as a value doesn't retain its type information

I thought I'd be able to simply query a given field on the rollup object in question, test for its type using `instanceof`, and then move on to rolling up. Unfortunately, that approach failed on my very first test where the rollup object didn't have the rollup field initialized. I needed to find something -- _anything_ -- that would give me a clue about what the type was for a given field at runtime, and found it in the `DisplayType` enum. Indeed, I found out after creating the default value initializer that this was the same method employed by a number of dynamic Apex test libraries:

```java
// in Rollup.cls
private virtual class DefaultSObjectFieldInitializer {
  public final Datetime defaultDateTime = Datetime.newInstanceGmt(1970, 1, 1);
  public final Long maximumLongValue = (Math.pow(2, 63) - 1).longValue();
  public final Long minimumLongValue = this.maximumLongValue * -1;

  public virtual Object getDefaultValue(SObjectField field) {
      DescribeFieldResult fieldDescribe = field.getDescribe();
      if (fieldDescribe.isDefaultedOnCreate()) {
        return fieldDescribe.getDefaultValue();
      }
      // not surprisingly, "getDefaultValue" on the DescribeFieldResult returns null for fields without default values
      // this is a shame - all types *should* have default values. Instead, we have the privilege of getting to initialize them
      Object initializedDefault;
      switch on fieldDescribe.getType() {
      when CURRENCY, DOUBLE, INTEGER, LONG, PERCENT {
        initializedDefault = 0;
      }
      when DATETIME {
        initializedDefault = this.defaultDateTime;
      }
      when DATE {
        initializedDefault = this.defaultDateTime.dateGmt();
      }
      when TIME {
        initializedDefault = this.defaultDateTime.timeGmt();
      }
      when STRING, ID, TEXTAREA, URL, PHONE, EMAIL{
        initializedDefault = '';
      }
      when PICKLIST, MULTIPICKLIST {
        // more on this part in a second
        initializedDefault = new PicklistController(field.getDescibe()).getDefaultValue(field);
      }
      when else {
        throw new IllegalArgumentException('Field: ' + field + ' of type: ' + fieldType.name() + ' specified invalid for rollup operation');
      }
    }
    return initializedDefault;
  }
}
```

### Finding default SObject fields for different DisplayTypes is fun

In the end, this Anonymous Apex script proved invaluable for hunting down standardly available fields of special types like `TIME`:

```java
public static void printDisplayTypeInfo(DisplayType desiredType) {
  Map<String, SObjectType> namesToTypes = Schema.getGlobalDescribe();
  for(SObjectType sType : namesToTypes.values()) {
    Map<String, SObjectField> fields = sType.getDescribe().fields.getMap();
    for(String fieldName : fields.keyset()){
      SObjectField field = fields.get(fieldName);
      DescribeFieldResult describeResult = field.getDescribe();
      if(describeResult.getType() == desiredType && describeResult.isUpdateable()) {
          System.debug('SObjectType: ' + sType);
          System.debug(describeResult.getName());
          // you could put a return statement here to only print the first result found
      }
    }
  }
}
```

I had never worked with the ContactPointAddress or ContactPointEmail objects before; they're relatively new additions to the system, and it was fun to learn a bit more about them while using them to wire up different zany relationships.

### Object-Oriented Programming Is Extremely Powerful (All Dates Are Numbers)

I've talked quite a bit about the infamous `switch` statement now in the `DecimalRollupCalculator`. After implementing all of the rollup operations for numbers, I teetered at the precipice -- how to take the logic in `DecimalRollupCalculator` and generalize it so that other subclasses could make use of it. As I considered the horrors of a `switch` statement that needed to differentiate not only between different rollup operations, but also their _context_ (was it an insert? an update? a delete??), my stomach began to twist. I had just written my first failing test for implementing MAX for Datetimes. Would my response _really_ be to copy pasta?

Then it hit me. Datetimes are all stored uniformly within Salesforce in UTC time. UTC can be represented by numbers. `Dates` are just `Datetime`s with a zero'd out `Time` section. The game was on. In the end, this section _truly_ took very little additional code to get right:

```java
// omitting the Datetime parent class, which itself descends from DecimalRollupCalculator
// the reason should be clear if you take a peek at the source code. While it's simple, an
// excerpt from DatetimeRollupCalculator is shown below in the "SOQL Drops Milliseconds From Datetimes ..." section
private class DateRollupCalculator extends DatetimeRollupCalculator {
    // for Date, it's not necessary to override the "getDecimalOrDefault" method in DatetimeRollupCalculator
    // because the conversion only happens in "getReturnValue"
    public DateRollupCalculator(Object priorVal, SObjectField operationField) {
      super(Datetime.newInstanceGmt((Date) priorVal, Time.newInstance(0, 0, 0, 0)), operationField);
    }

    public override Object getReturnValue() {
      return ((Datetime) super.getReturnValue()).dateGmt();
    }
  }

  private class TimeRollupCalculator extends DatetimeRollupCalculator {
    public TimeRollupCalculator(Object priorVal, SObjectField operationField) {
      super(Datetime.newInstanceGmt(FieldInitializer.defaultDateTime.dateGmt(), (Time) priorVal), operationField);
    }

    public override Object getReturnValue() {
      return ((Datetime) super.getReturnValue()).timeGmt();
    }

    protected override Decimal getDecimalOrDefault(Object potentiallyUnitializedDecimal) {
      Datetime defaultDatetime;
      if (potentiallyUnitializedDecimal instanceof Time) {
        defaultDatetime = Datetime.newInstanceGmt(FieldInitializer.defaultDateTime.dateGmt(), (Time) potentiallyUnitializedDecimal);
      } else if (potentiallyUnitializedDecimal instanceof Decimal) {
        defaultDatetime = Datetime.newInstance(((Decimal) potentiallyUnitializedDecimal).longValue());
      } else {
        defaultDatetime = FieldInitializer.defaultDateTime;
      }
      return defaultDatetime.getTime();
    }
  }
```

That commit -- and the powerful realization that I'd been able to add a possible _sixty-three_ different permutations for rollup operations in what amounted to a mere ~32 lines of code ... that's the power of Object-Oriented Programming!

**Edit** -- what I failed to mention, upon originally publishing this article, was that there _was_ a duplicated switch statement (for String-based rollups); a detail that had bothered me in the days leading up to release, but which I didn't have the time (or energy, after several marathon days spent "finishing" `Rollup`) to address prior to launching. Several days after releasing, I went back and made use of the [Chain Of Responsibility](https://en.wikipedia.org/wiki/Chain-of-responsibility_pattern) to break up this duplication. As is common when virtual methods are added at the parent level, this actually ended up _increasing_ the lines of code in the final `Rollup` file. At the same time, indentation (one of the great sins present in the use of switch statements) was much reduced. What was left? [One switch statement to rule them all, with virtual methods to bind them](https://github.com/jamessimone/apex-rollup/blob/v1.0.2/rollup/main/default/classes/Rollup.cls#L1407). While lines of code can be a metric for complexity, it also often ends up being deceptive -- the code reads more like a story, now, where rollup operations are explicitly opted into, instead of having to scan through a switch statement to determine which operation leads to which result.

### intValue() on a Long can be a wild ride

While working on MAX/MIN based code, I realized quickly that there were only two reliable sentinel values when it came to numbers -- the maximum possible number that would fit into a 64-bit number (a `Long`), and the minimum possible number. What bit me _really, really_ hard while working on implementing min/max for picklists? To anwer that, first an aside -- min/maxing on a picklist is supposed to return the deepest possible entry in the picklist (for MAX), or the closest to the top of the picklist (for MIN). Picklists have many ... interesting ... subleties in Salesforce, and the implicit concept of "rank" (just look at the Path components for Lead Status or Opportunity Stage Name) is just one of their many quirks.

If a value doesn't exist on the lookup object, that value should always lose; on a MIN it should be greater than the "rank" of any other field (so that any comparison to it leads to a truthy "less than" evaluation); on a MAX it should be less than the rank of any other field (likewise; it should lead to a truthy "greater than" evaluation). Making an object to perform these evaluations for picklists was a great exercise in Object Oriented Programming -- frequently throughout this project, that proved to be the case. Making the `PicklistController` inner class descend from the `DefaultFieldInitializer` made sense in the context of the object hierarchy. Though the `PicklistController` had many more responsibilities, it could also handle setting the default value for a picklist with ease.

Where things finally took a turn for the worse was when my first picklist test for ensuring MIN/MAX was working correctly failed. The logic looked perfect -- what could be the issue? It took me a painful 30 minutes to _see_ the issue, so deeply ingrained were my assumptions about the way that `Long` values would translate to `Integers`. Only at the last second did I truly comprehend that I had betrayed myself:

```java
private class PicklistController extends DefaultSObjectFieldInitializer {
// etc ...

  private Integer getSentinelValue(Boolean isMin) {
    return (isMin ? this.maximumLongValue : this.minimumLongValue).intValue();
  }
}
```

Passing `Boolean` values as method arguments is always to be strongly discouraged, but this method call was already on the tail end of a ternary and I felt, when creating it, that I had no other option. I will say, though, that I once had a coworker who was deeply passionate about using nested ternaries. I lost track of him over the years, but ... perhaps the issue would have been clearer to me if the culprit had been in a truly doubled ternary; after all, who in their right minds could avoid investigating such a travesty?

In any case. Do you know what the integer values are for the minimum and maximum `Long` values (-2^63 and 2^63, respectively)?

```java
Long maximumLongValue = (Math.pow(2, 63) - 1).longValue();
Long minimumLongValue = maximumLongValue * -1;

System.debug(maximumLongValue); // prints: 9223372036854775807
System.debug(minimumLongValue); // prints: -9223372036854775807

// Now as ints!
System.debug(maximumLongValue.intValue()); // prints -1
System.debug(minimumLongValue.intValue()); // prints 1
```

Ouch. Well, that explained my failing test! My understanding (after a brief foray into the details) is that casting to `Integer` or calling `intValue()` is safe within the bounds of the 32-bit allowed integer sizes, but after that all bets are off. Creating the min/max integer bounds did the trick wonderfully. Running into edge cases like this can hurt, but it also expands the mind -- you only get bit by something like this once before knowing to look out for it next time around. Plus, I ended up being able to get rid of the `Boolean` passing altogether -- two birds with one stone!

### SOQL drops the milliseconds from Datetime fields when they are retrieved from the database

This was a fun one -- and one that I was already aware of from lurking on the [SFXD Discord](https://join.sfxd.org/). This is a real pain -- especially in testing --, but in the end the following bit did the trick nicely:

```java
// one of the worst things about SOQL is that Datetimes retrieved have the millisecond values truncated
Datetime datetimeWithMs = potentiallyUnitializedDecimal instanceof Decimal
  ? Datetime.newInstance(((Decimal) potentiallyUnitializedDecimal).longValue())
  : ((Datetime) potentiallyUnitializedDecimal);
// reading through the source code provides a more cogent rationale
// for the above eyesore over anything I can muster here.
return Datetime.newInstanceGmt(
    datetimeWithMs.yearGmt(),
    datetimeWithMs.monthGmt(),
    datetimeWithMs.dayGmt(),
    datetimeWithMs.hourGmt(),
    datetimeWithMs.minuteGmt(),
    datetimeWithMs.secondGmt()
  )
```

---

## Custom Rollup Wrap-up

Well, it's out there now. This article -- and the corresponding code -- has consumed an enormous quantity of time since work began on it in earnest in early December. I would highly recommend developers check out [the source code](https://github.com/jamessimone/apex-rollup/) (and the travelogue style [commit history](https://github.com/jamessimone/apex-mocks-stress-test/commits/rollup)). Over the coming months I plan to add more functionality to `Rollup` -- for now, I'm hopeful that you'll consider trying it out. It's efficient, scales elastically, allows for rollups on fields (like `Task.ActivityDate`) that don't always allow for rollups in SOQL, and is well-tested.

I'm aware that `Rollup` doesn't hit 100% feature-parity versus DLRS ... and though I have plans to meet that challenge, as well, I believe that we're well past the fabled "80% of the functionality" stage. If your org (like many out there) is struggling under the weight of DLRS' auto-spawned triggers, I'm confident that `Rollup` will be a valuable tool for both the declaratively-minded as well as the developers out there.

---

## Postscript

My original intent was to finish this article by December 27th, the one year anniversary of the [Joys Of Apex](/). Despite some insanely long days spent writing, that didn't quite happen. Despite that, I just wanted to say that the readers of this series have helped ease the burden in a year that was extremely challenging for many people. Stuck inside for large portions of time, I took to writing -- and it shows. More than ten of the articles I wrote over the last year came out during the first 2 months of the pandemic -- some only days apart from one another. I do not advertise, and have not attempted to monetise in any way the incredible surge of traffic my personal website has experienced as a result. My intent is to provide readers with free content and materials to refer back to. Indeed, the only work I've done on the site over the past year was immediately preceeding this article, as I spruced up the Joys Of Apex blog page to better show off the posts.

All of that is to say -- thank you for an incredible year. Here's to hoping that 2021 will prove a better year for the world, and for you.

The original version of [Replacing DLRS With Custom Rollup can be read on my blog.](https://www.jamessimone.net/blog/joys-of-apex/replacing-dlrs-with-custom-rollup/)
