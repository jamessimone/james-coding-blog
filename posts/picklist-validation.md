> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Picklist Validation

> :Author src=github,date=2020-04-14T15:00:00.000Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

Picklists in Salesforce replace traditional HTML select fields on the frontend. They also are driven by complex metadata types that we don't have programmatic access to in our code. I'll discuss one potential approach to strongly typing a picklist's values based on describe results and a little boilerplate.

"Magic" strings have a special place in programming hell; while there have been some language attempts to relegate strings to their respective places (static, final strings come to mind ...), picklists in Salesforce walk us away from the safety that we typically can embrace in a strongly-typed language. Furthermore, since Apex is character-insensitive, you're just one slip of the Shift key away from accidentally setting a field's values to some lowercase variation of the value you wanted -- hello, data fixes and hotfixes! (Alternatively, if you're talking about a restricted custom picklist ... hopefully you're testing that code path, or hello exceptions!)

So what can we do to try to sew up the disconnect between where picklist values live (either `StandardValueSet` or `GlobalValueSet`), and some semblance of strong typing on the contents of their values?

## Enter DescribeFieldResults

Savvy SFDC users know that there's metadata, and then there's _metadata_. `DescribeFieldResults` belong to the latter case of metadata; the good stuff that's available through the `getDescribe` methods available on SObjects (to say nothing of the global Describe metadata, that's a whole 'nother can of worms ...).

You can access metadata about any Salesforce SObjectField through the following syntax:

```java | Anonymous Apex
//typically held in some kind of helper class
//we'll use the example of Account.Industry
public static List<String> getPicklistValues(SObjectField field) {
  Schema.DescribeFieldResult fieldMetadata = field.getDescribe();
  List<Schema.PicklistEntry> picklistEntries = fieldMetadata.getPicklistValues();

  List<String> picklistValues = new List<String>();
  for(Schema.PicklistEntry picklistEntry : picklistEntries) {
    picklistValues.add(picklistEntry.getValue());
  }
  return picklistValues;
}

Schema.SObjectField industry = Account.Industry;
List<String> industries = getPicklistvalues(industry);
//prints out Agriculture, Apparel, Banking, Biotechnology, etc ...
```

That's all well and good; we can access the contents of a picklist. If this is news to anybody, definitely check out the Salesforce Developer documentation for [PicklistEntry](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_class_Schema_PicklistEntry.htm). I'm not going to cover much of it, and there are a handful of other interesting methods on the object that gets returned. In general, the `Describe` level metadata returned for fields and objects is worth digging into in the Apex Developer guide -- you'd be surprised to find out how much you have access to at this level.

You know the story, though -- simply having access to the fields isn't really going to do much in the way of providing you with intellisense / safely providing you with values. Plus, what happens if we try to unsafely access values that aren't part of a picklist?

```java
@isTest
static void it_should_validate_field_is_a_picklist() {
  Exception e;
  try {
    getPicklistValues(Opportunity.Name);
  } catch(Exception ex) {
    e = ex;
  }

  System.assertEquals(null, e);
}
```

Whew. The test passes. Of course, the question about whether or not it's valid for a helper method to return an empty list for a non-valid field is one for the ages -- you may find yourself wanting to throw an exception there. That's fine. For the purposes of this exercise, I leave the matter of exception handling up to you.

## Object-Oriented Picklists

We know how to get picklist values, but what's the best way to encapsulate them per SObjectField? We have some behavior -- namely, the population of the picklist fields for a given SObjectField, that we'd like to have shared. This, my friends, screams: "abstract class"!

```java | classes/Picklist.cls
public abstract class Picklist {
  private final SObjectField field;
  protected final List<String> picklistValues;

  @testVisible
  protected Picklist(SObjectField field) {
      this.field = field;
      this.picklistValues = this.getPicklistValues(field);
  }

  protected String validatePicklistValue(String value) {
    if(!picklistValues.contains(value)) {
      throw new PicklistException(value + ' is not a valid entry for ' + this.field.getDescribe().getName() + '!');
    }

    return value;
  }

  private List<String> getPicklistValues(SObjectField field) {
    Schema.DescribeFieldResult fieldMetadata = field.getDescribe();
    List<Schema.PicklistEntry> picklistEntries = fieldMetadata.getPicklistValues();

    List<String> returnValues = new List<String>();
    for(Schema.PicklistEntry picklistEntry : picklistEntries) {
      returnValues.add(picklistEntry.getValue());
    }
    return returnValues;
  }

  private class PicklistException extends Exception {}
}
```

And here's how you would implement and test that picklist validation is working:

```java
public class AccountIndustry extends Picklist {
  private AccountIndustry() {
    super(Account.Industry);
  }

  //use the singleton pattern
  //for ease of property access
  public static AccountIndustry Instance {
    get {
      if(Instance == null) {
        Instance = new AccountIndustry();
      }
      return Instance;
    }
    private set;
  }

  public String AGRICULTURE { get { return this.validatePicklistValue('Agriculture'); }}
  public String APPAREL { get { return this.validatePicklistValue('Apparel'); }}
  //etc ...
}

@isTest
private class AccountIndustryTests {
  @isTest
  static void it_should_return_account_industries() {
    System.assertEquals('Agriculture', AccountIndustry.Instance.AGRICULTURE);
    System.assertEquals('Apparel', AccountIndustry.Instance.APPAREL);
  }
}
```

I'm not _crazy_ about the [Singleton pattern](/building-a-better-singleton) (which you may remember we also already covered in the [Idiomatic Apex](/idiomatic-salesforce-apex/) post), but this is one of the main use-cases I feel it is acceptable: for exposing public methods in a static-y way while still allowing for use of the `this` keyword (here, primarily important for encapsulating the `validatePicklistValue` method within the parent `Picklist` class).

So long as you're generating test-coverage by attempting to access the strings like `AGRICULTURE`, you can 100% avoid getting bitten by errors like `bad value for restricted picklist field`:

```java
//back in AccountIndustry
//let's misspell something on purpose to prove the point
public String AGRICULTURE { get { return this.validatePicklistValue('Agricolae'); }}

//and in the tests:
@isTest
static void it_should_return_account_industries() {
  System.assertEquals('Agriculture', AccountIndustry.Instance.AGRICULTURE);
  System.assertEquals('Apparel', AccountIndustry.Instance.APPAREL);
}
```

This causes the test to fail:

```
Picklist.PicklistException: Agricolae is not a valid entry for Industry!
```

## Picklists In A Nutshell

At the end of the day, I think it's safe to say that picklists don't get a lot of love within the Salesforce community. Admins are constantly asking how to restrict values by profile instead of by record type; developers are kept busy trying to ensure the correct picklist values are used.

What do you think of this pattern? Is it useful for you in your own work? I like being able to get intellisense **and** test-validation for my restricted picklist values ... on the other hand, I hate writing singleton property accessors, and have spent more hours than I'd care to admit trying to "solve" that problem through a variety of abstract class hacks ... none of which has borne any fruit. That's the nature of progression, though -- failure is a part of the process. As Teddy Roosevelt once said:

> It is hard to fail, but it is worse never to have tried to succeed.

Thanks for joining me for another read within [The Joys Of Apex](/) -- I hope that even if strongly-typing your picklists isn't something you're likely to do, that you enjoyed the read. Till next time!
