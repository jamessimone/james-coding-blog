> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Lightweight Trigger Handler

> :Author src=github,date=2020-02-29T15:12:03.284Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

Tap into the power of the Trigger Handler pattern in Salesforce with this extremely lightweight Trigger Handler framework. I was doing some research for an upcoming post (on how to write performant tests, and why that matters) when I name-dropped probably the single most used pattern on the SFDC platform — the concept of the single "handler" class per SObject trigger: the Trigger Handler pattern.

> :Tabs
>
> > :Tab title= Trigger Pattern Notes
> >
> > A number of prominent SFDC personalities — [Kevin O'Hara](https://github.com/kevinohara80/sfdc-trigger-framework), [Dan Appleman](https://advancedapex.com/), to name two — have championed this pattern over the years. Despite this, it lacks support from the [official Salesforce documentation on Triggers](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers.htm) ... although I actually think that, in general, the Apex Developer Guide is amongst the most well-maintained knowledge bases for code anywhere. In any case, using one "handler" class per SObject is of crucial importance — having seen a few orgs that made the use of multiple Triggers for the same SObject, I can only say that tracking updates and following the code becomes substantially harder if you put logic into your triggers themselves or if your triggers call multiple classes.
>
> > :Tab title= Trigger Pattern Footnote
> >
> > Especially after a recent experience helping a friend debug his Mongoose.js / Mongo application, I would submit that great documentation can lift up a sub-par API, yet most API docs I read seem doomed to be afterthoughts, sadly outdated and lacking completeness — dragging down things that might otherwise have been helpful. If there's one thing that Salesforce has done _really_ well over the years, it's been their constant maintenance of the official docs.

I don't think there's a lot of room in the "Trigger Handler" space; if anything, I would simply suggest using Kevin O'Hara's pattern and being done with it. With that being said, there are a few reasons that you might want to go with something considerably more light-weight:

- You don't care about recursion in triggers / don't need to detect for it
- You don't care about disabling other SObject triggers / don't want to be pegged to a specific API for doing so

There was one article I read online that, after reviewing Kevin O'Hara's implementation, decided it was too verbose ... then made an interface for their own implementation, forcing any potential consumer to implement all of the trigger methods in order to subscribe. I went for a run after seeing that particular ... suggestion.

## Implementing The Simplest Possible Trigger Handler

This is the most streamlined Trigger Handler implementation that I could stomach:

```java | classes/TriggerHandler.cls
public virtual class TriggerHandler {
  @testVisible
  private static TriggerOperation triggerContext = Trigger.operationType;

  protected TriggerHandler() {
    if(!Trigger.isExecuting && !Test.isRunningTest()) {
      throw new TriggerHandlerException('TriggerHandler used outside of triggers / testing');
    }
  }

  public void execute() {
    switch on triggerContext {
      when BEFORE_INSERT {
        this.beforeInsert(Trigger.new);
      }
      when BEFORE_UPDATE {
        this.beforeUpdate(Trigger.newMap, Trigger.oldMap);
      }
      when BEFORE_DELETE {
        this.beforeDelete(Trigger.oldMap);
      }
      when AFTER_INSERT {
        this.afterInsert(Trigger.newMap);
      }
      when AFTER_UPDATE {
        this.afterUpdate(Trigger.newMap, Trigger.oldMap);
      }
      when AFTER_DELETE {
        this.afterDelete(Trigger.oldMap);
      }
      when AFTER_UNDELETE {
        this.afterUndelete(Trigger.newMap);
      }
    }
  }

  protected virtual void beforeInsert(List<SObject> newRecords) {}
  protected virtual void beforeUpdate(Map<Id, SObject> updatedRecordsMap, Map<Id, SObject> oldRecordsMap) {}
  protected virtual void beforeDelete(Map<Id, SObject> deletedRecordsMap) {}
  protected virtual void afterInsert(Map<Id, SObject> newRecordsMap) {}
  protected virtual void afterUpdate(Map<Id, SObject> updatedRecordsMap, Map<Id, SObject> oldRecordsMap) {}
  protected virtual void afterDelete(Map<Id, SObject> deletedRecordsMap) {}
  protected virtual void afterUndelete(Map<Id, SObject> undeletedRecordsMap) {}

  private class TriggerHandlerException extends Exception {
  }
}
```

Every time I use a switch statement now that they're finally out in Apex, I find myself asking the question: "was that brief bit of syntactical sugar really worth the extra lines?" Perhaps not. You could drop a few lines by using our good old if/else paradigm against the `Trigger.operationType` enum. I shed a single tear of happiness when that enum was released, representative of the years spent looking at Trigger Handler frameworks' boolean comparisons on `Trigger.isInsert`, `Trigger.isDelete`, `Trigger.isBefore`, etc ...

After getting some feedback from a few friends, I've ever dropped the traditional `List<SObject>` arguments represented by `Trigger.new` and `Trigger.old` for everything except `beforeInsert`, where we naturally don't have access to our Map objects since the records don't have Ids yet.

Here's some similarly slimmed down tests:

```java | classes/TriggerHandler_Tests.cls
@isTest
private class TriggerHandlerTests {
  // I normally put private classes at the bottom, but to prevent you from having to scroll ...
  private class TestTriggerHandler extends TriggerHandler {
    public TriggerOperation Method { get; private set;}

    @testVisible
    protected override void beforeInsert(List<SObject> newRecords) {
      this.Method = TriggerOperation.BEFORE_INSERT;
    }
    @testVisible
    protected override void beforeUpdate(Map<Id, SObject> updatedRecordsMap, Map<Id, SObject> oldRecordsMap) {
      this.Method = TriggerOperation.BEFORE_UPDATE;
    }
    @testVisible
    protected override void beforeDelete(Map<Id, SObject> deletedRecordsMap) {
      this.Method = TriggerOperation.BEFORE_DELETE;
    }
    @testVisible
    protected override void afterInsert(Map<Id, SObject> newRecordsMap) {
      this.Method = TriggerOperation.AFTER_INSERT;
    }
    @testVisible
    protected override void afterUpdate(Map<Id, SObject> updatedRecordsMap, Map<Id, SObject> oldRecordsMap) {
      this.Method = TriggerOperation.AFTER_UPDATE;
    }
    @testVisible
    protected override void afterDelete(Map<Id, SObject> deletedRecordsMap) {
      this.Method = TriggerOperation.AFTER_DELETE;
    }
    @testVisible
    protected override void afterUndelete(Map<Id, SObject> undeletedRecordsMap) {
      this.Method = TriggerOperation.AFTER_UNDELETE;
    }
  }

  @isTest
  static void it_should_perform_before_insert() {
    TestTriggerHandler testHandler = new TestTriggerHandler();
    TriggerHandler.triggerContext = TriggerOperation.BEFORE_INSERT;

    testHandler.execute();

    System.assertEquals(TriggerOperation.BEFORE_INSERT, testHandler.Method);
  }

  @isTest
  static void it_should_perform_before_update() {
    TestTriggerHandler testHandler = new TestTriggerHandler();
    TriggerHandler.triggerContext = TriggerOperation.BEFORE_UPDATE;

    testHandler.execute();

    System.assertEquals(TriggerOperation.BEFORE_UPDATE, testHandler.Method);
  }

  @isTest
  static void it_should_perform_before_delete() {
    TestTriggerHandler testHandler = new TestTriggerHandler();
    TriggerHandler.triggerContext = TriggerOperation.BEFORE_DELETE;

    testHandler.execute();

    System.assertEquals(TriggerOperation.BEFORE_DELETE, testHandler.Method);
  }

  @isTest
  static void it_should_perform_after_insert() {
    TestTriggerHandler testHandler = new TestTriggerHandler();
    TriggerHandler.triggerContext = TriggerOperation.AFTER_INSERT;

    testHandler.execute();

    System.assertEquals(TriggerOperation.AFTER_INSERT, testHandler.Method);
  }

  @isTest
  static void it_should_perform_after_update() {
    TestTriggerHandler testHandler = new TestTriggerHandler();
    TriggerHandler.triggerContext = TriggerOperation.AFTER_UPDATE;

    testHandler.execute();

    System.assertEquals(TriggerOperation.AFTER_UPDATE, testHandler.Method);
  }

  @isTest
  static void it_should_perform_after_delete() {
    TestTriggerHandler testHandler = new TestTriggerHandler();
    TriggerHandler.triggerContext = TriggerOperation.AFTER_DELETE;

    testHandler.execute();

    System.assertEquals(TriggerOperation.AFTER_DELETE, testHandler.Method);
  }

  @isTest
  static void it_should_perform_after_undelete() {
    TestTriggerHandler testHandler = new TestTriggerHandler();
    TriggerHandler.triggerContext = TriggerOperation.AFTER_UNDELETE;

    testHandler.execute();

    System.assertEquals(TriggerOperation.AFTER_UNDELETE, testHandler.Method);
  }
}
```

Thanks especially to the ever helpful [Suraj Pillai](https://github.com/surajp/), whose feedback on the original tests helped tighten up this example by showing how you would implement this framework in your actual Triggers -- by instantiating your handler (`TestTriggerHandler` in this example) and calling `execute()`. That's it, really; you should never have any more logic than that in your Apex triggers.

## Syntax Sugar

Lastly, I'll just say that I've only ever found one set of helper methods necessary in the TriggerHandler pattern — it's fairly common to need to get records with changed fields when performing logic within the Handler classes that end up extending the TriggerHandler. You could add the following one/two methods (one if you only wanted to use the bulk `List<SObjectField>` option) to do yourself a favor:

```java
//in TriggerHandler.cls
protected List<SObject> getUpdatedRecordsWithChangedField(SObjectField field) {
    return this.getUpdatedRecordsWithChangedFields(new List<SObjectField>{ field });
}

protected List<SObject> getUpdatedRecordsWithChangedFields(List<SObjectField> fields) {
    List<SObject> updatedRecords = new List<SObject>();

    for(SObject record : Trigger.new) {
        SObject oldRecord = Trigger.oldMap.get(record.Id);
        for(SObjectField field : fields) {
            if(record.get(field) != oldRecord.get(field)) {
                updatedRecords.add(record);
            }
        }
    }
    return updatedRecords;
}
```

## Wrapping Up

That's it! It's a short one, but I hope you enjoyed this post. The aforementioned [Writing Performant Apex Tests](/blog/joys-of-apex/writing-performant-apex-tests/) article has also now been published. The source code can also be browsed as a [branch off of my repo](https://github.com/jamessimone/apex-mocks-stress-test/tree/trigger-handler)!

As well, on the subject of filtering records that have changed based on `SObjectField` criteria, as shown in the above helper methods, I have since also written a post on [the power of Lazy Iteration](/lazy-iterators) which should prove eye-opening when considering how to keep your `TriggerHandler` classes performant in the context of having to assemble many sub-lists of changed SObjects based on different `SObjectField` criteria. The `getUpdatedRecordsWithChangedFields` method shown above is a typically-eager implementation, and all of the records being passed to the Trigger get iterated through each time the method is called; if you need to accomplish separate processing for records with different changed fields, you'll quickly waste processing cycles doing so. Lazily implemented iteration prevents this performance slowdown - I'd highly recommend reading the article for more information about this very powerful pattern!

The original version of [Lightweight Trigger Handler can be read on my blog.](https://www.jamessimone.net/blog/joys-of-apex/lightweight-trigger-handler/)
