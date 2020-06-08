> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Enum Apex Class Gotchas

> :Author src=github

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

The abstract enum class in Apex can be very helpful as a class-like object, but there are a few things you should keep in mind to avoid getting bitten by the use of enums. I was bitten hard by the use of enums recently, so I’d like to go a bit into depth on these shady, ill-documented characters; their usages, where they shine, and where you too might get into gray areas using them.

What are enums? That’s a tricky question to answer. Here's the official documentation description:

> An enum is an abstract data type with values that each take on exactly one of a finite set of identifiers that you specify. Enums are typically used to define a set of possible values that don’t otherwise have a numerical order, such as the suit of a card, or a particular season of the year.

The easy way to think of them are compile-time "constants" that can be statically typed. They’re sort of like a list of static strings, in that sense, and they obey some interesting rules in addition to the basics:

Enums can be defined within a class or in a separate .cls file with the following notation:

```java
//or global
public enum ExampleEnum { FirstValue, SecondValue }
```

All enums have access to two methods: `name()` and `ordinal()` - name simply returns the string version of your enum instance, ordinal returns its index in the list.

- Using the above example, calling `ExampleEnum.SecondValue.name()` would return `SecondValue` as a String
- Using the above example, calling `ExampleEnum.SecondValue.ordinal()` would return `1` as an Integer
- You can also call `ExampleEnum.values()[0]` to return the Enum instance of `FirstValue`

> :Tabs
>
> > :Tab title= Enum Notes
> >
> > Enums are sealed; you can’t add further methods or attributes to an enum. In other words ... they’re sort of a poor man’s class. The latest version of Java actually offers up a different take on this specifically for POJOs (plain old Java objects, sometimes called "beans" as well ... ): [records](https://blogs.oracle.com/javamagazine/java-14-arrives-with-a-host-of-new-features#anchor_5). I mention this specifically because Enums, like these new Record types, _are_ a derivative of the plain Object class; they just can't be tested for using something like `instanceof` (try it yourself in Apex: `System.debug(LoggingLevel.ERROR instanceof Enum);` will sadly fail to compile), yet they do have hidden implementations of the basic Object methods, `hashCode()` and `equals()`.
>
> > :Tab title= Enum Footnote
> >
> > The [rather excellent documentation on using custom types as Map keys or within Sets](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/langCon_apex_collections_maps_keys_userdefined.htm) is for sure worth a read if you're looking to understand why these methods matter; it's also particularly important if you're looking to implement custom sorting using the [Comparable interface](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_comparable.htm#apex_comparable) in Apex

So why do people like to use enums? They offer better type-safety than the use of static strings. For another, they self-encapsulate their data; while the use of a static string potentially says something about what you’re interacting with, in reality the VALUE behind that string can change - either with reassignment, if the variable isn’t listed as final, or simply by changing the code.

Plus, in an if/else or switch statement, testing against an enum’s value gives the developer the pleasure of understanding immediately the statement being evaluated at hand. You don’t have to go look up the value of that string - it’s right there in front of you! It’s a great mechanism for capturing certain known conditions; while the docs use the example of Seasons, and cardinal directions, perhaps a better example might be types of errors returned from an API (if they come in string form ...).

So ... that all seems pretty good, actually. What are the downsides to enums, then?

## Using Enums In Data Classes

For one -- you might be tempted (as I was) to use enums in other languages when communicating to Salesforce via API. Spoiler alert: that’s not gonna work. You CAN include an enum (or even a list of enum values!) as a property on an object being used in an Apex endpoint:

```java
public enum Season { WINTER, SPRING, SUMMER, FALL }

public class DataObject {
    public Integer MyProperty { get; set }
    public Season MySeason { get; set; }
}

//... in your web service
@HttpPost
global static String post(DataObject data) {
    //.. do something now that your object's been correctly deserialized
}

```

What you **can't**, under any circumstances do, is try to send an _enum_ to Salesforce to represent that the corresponding `MySeason` on the data object. _You have to send a string instead_. Otherwise your service is going to throw an error trying to deserialize your object -- ouch. The reason for that will become abundantly clear as I walk you through this next part - the danger of using enums as key values in Map instances with Salesforce.

## Enums in Batchable & Queueable Apex

> :Tabs
>
> > :Tab title= Batchable & Queueable Apex
> >
> > When can we reference prior values in a new execution context? Within Batchable and Queueable Apex! Let’s dive in to a simple example (one of the reasons I loathe Batchable Apex -- this "simple" example takes up quite a bit of real estate):
>
> > :Tab title= Stackexchange Footnote
> >
> > I probably account for 300+ of the (at this moment) 541 views of this [question on the Salesforce Stack Exchange](https://salesforce.stackexchange.com/questions/158557/enums-as-map-keys-dont-work-in-batchable), which first alerted me to this issue several years ago. I hadn't personally been bitten by this particular issue; at the time I was writing a custom equality library for Apex and I was trying to figure out if there was a graceful way to handle Enums.

```java
public class EnumBatchableExample implements Database.Batchable<SObject> {

    public enum Direction { NORTH, SOUTH, EAST, WEST }

    public class TestIterable implements Iterable<SObject> {
        public Iterator<SObject> Iterator() {
            return new List<SObject>().iterator();
        }
    }

    @testVisible private static Integer firstHashCode;
    @testVisible private static Integer secondHashCode;
    @testVisible private static Map<Direction, Integer> directionToNumber = new Map<Direction, Integer>();

    public Iterable<SObject> start(Database.BatchableContext bc) {
        System.debug('Starting EnumBatchableExample');

        Direction north = Direction.NORTH;
        Direction south = Direction.SOUTH;
        firstHashCode = north.hashCode();
        secondHashCode = south.hashCode();
        directionToNumber.put(north, firstHashCode);
        directionToNumber.put(south, secondHashCode);

        System.debug('String version of north: ' + String.valueOf(Direction.NORTH));
        System.debug('String verison of south: ' + String.valueOf(Direction.SOUTH));
        System.debug('String verison of this: ' + String.valueOf(this));

        return new TestIterable();
    }

    public void execute(Database.BatchableContext bc, List<SObject> records) {}

    public void finish(Database.BatchableContext bc) {
        System.debug('Current map values: ' +  directionToNumber);
        System.debug('EnumBatchableExample finished');
    }
}
```

And then the tests:

```java
@isTest
private class EnumBatchableExampleTests {
    static Integer northHashcode = EnumBatchableExample.Direction.NORTH.hashCode();
    static Integer southHashcode = EnumBatchableExample.Direction.SOUTH.hashCode();

    static EnumBatchableExample.Direction north = EnumBatchableExample.Direction.NORTH;
    static EnumBatchableExample.Direction south = EnumBatchableExample.Direction.SOUTH;

    @TestSetup
    static void setup() {
        //Ids consistently work as map keys ... is that because
        //the hashCode is stable between execution contexts?
        insert new Account(Name = 'EnumBatchableTest');
    }

    @isTest
    static void it_should_retain_hashcode_references() {
        Account acc = [SELECT Id FROM Account];
        System.debug('Account Id\'s hashCode for this run: ' + ((Object)acc.Id).hashCode());

        Database.Batchable<SObject> batchable = new EnumBatchableExample();
        System.debug('Batchable\'s hashCode for this run: ' + ((Object)batchable).hashCode());
        System.debug('Custom\'s hashCode for this run: ' + ((Object)new CustomHashCode()).hashCode());

        Test.startTest();
        Database.executeBatch(batchable);
        Test.stopTest();

        System.assertEquals(northHashcode, EnumBatchableExample.firstHashCode);
        System.assertEquals(southHashcode, EnumBatchableExample.Direction.SOUTH.hashCode());
        System.assertEquals(true, EnumBatchableExample.directionToNumber.containsKey(north));
        System.assertEquals(true, EnumBatchableExample.directionToNumber.containsKey(south));
    }

    @isTest
    static void it_should_retain_hashcode_references_again() {
        Account acc = [SELECT Id FROM Account];
        System.debug('Account Id\'s hashCode for this run: ' + ((Object)acc.Id).hashCode());

        Database.Batchable<SObject> batchable = new EnumBatchableExample();
        System.debug('Batchable\'s hashCode for this run: ' + ((Object)batchable).hashCode());
        System.debug('Custom\'s hashCode for this run: ' + ((Object)new CustomHashCode()).hashCode());

        Test.startTest();
        Database.executeBatch(batchable);
        Test.stopTest();

        System.assertEquals(northHashcode, EnumBatchableExample.firstHashCode);
        System.assertEquals(southHashcode, EnumBatchableExample.Direction.SOUTH.hashCode());
        System.assertEquals(true, EnumBatchableExample.directionToNumber.containsKey(north));
        System.assertEquals(true, EnumBatchableExample.directionToNumber.containsKey(south));
    }

    private class CustomHashCode {
        public Integer hashCode() {
            return 1;
        }
    }
}
```

Both of these tests pass, no problem, and there's no way to "force" the issue because with both Batchable & Queueable Apex, you can't actually test the recursion of these jobs within tests. That said, I can show you the results:

![Apex enum debug log](/img/apex-enum-debug-log.jpg)

There's a lot to go through:

- You can see that **all** the hashCode values change between execution contexts (with the exception of our hard-coded custom implementation). I expected that for everything except the Account Id variables
- Debugging `String.valueOf(Direction.NORTH)` outputs the String: `NORTH`
- Debugging `String.valueOf(this)` within `EnumBatchableExample` outputs the name of the class, along with information about its > > member variables (none, in this case) and static variables

Intuitively, we have to expect that ".equals(Object o)" is overridden on the SObject class. You can find more tantalizing info about how exactly SObject equality works in one very specific place in the Apex Developer Guide: [Understanding Expression Operators](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/langCon_apex_expressions_operators_understanding.htm). Look for the keywords "Equality Operator", which in tantalizing brevity details what happens when you call "==" on something within Apex. There's also a great ribbing on the SOQL team, for good measure.

## Feeling A Little Enum

TL;DR, what have we learned?

- Enums are abstract types that can't be extended.
- You **can** send enum values to Apex endpoints, so long as the value you send is the string representation of the enum.
- You **can** use enums as keys within a Set or Map, so long as you're aware of a few edge cases.
- You **can't** assert for an enum's equality to a specific type using the `instanceof` operator
- You **can't** pass enums to a class constructor except as a specific enum instance; there's no way to do something like:

```java
public class MyClass {
    public MyClass(Enum someEnum) {
        //some detecting of which enum it is here, I guess
    }
}
```

That's all for now, folks!
