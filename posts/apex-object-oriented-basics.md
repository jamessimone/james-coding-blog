> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Apex Object-Oriented Basics

I've received a number of requests asking for a little background on Apex, so I've decided to create this little tutorial from the ground up. We'll be covering a number of different topics, including:

- object-oriented programming basics, static types, and encapsulation, use of the word "this"
- inheritance: virtual and abstract classes, as well as interfaces, the use of the "protected" and "super" keywords
- the power of polymorphism
- addendum: "transient" keyword

But before we begin, let's back up a step further and ask the question: _why is writing quality code important_?

## The Importance of Code Quality (And Compassion)

Writing quality code is an exercise, just as being compassionate is something we should all work towards. Nobody starts off writing perfect code, nor should anybody expect that of themselves. We all write code for various reasons: either because we're paid to do so or we enjoy it, our end goal in writing code should not be to write code, but to accomplish things. Our client/company needs a feature. We need functionality. In the end, the "writing of it" is often separate from the "how it works," and that is to our detriment. Developers who think their only responsibility should be writing code frequently seem surprised when their code doesn't work as intended.

Salesforce has spent billions making Apex, Lightning Web Components, etc ... into the lowest possible programming denominator (with the possible exception of those other leveler-of-playing-fields: JavaScript and Python). We're not God's gift to mankind by virtue of our ability to write something in possibly the most well-documented languages on the planet. Rather, the real gift that we should foster and focus on is our ability to identify problems and solve them in a sensible fashion; to be able to pick up where we left off when returning to something, and to be able to help our users. There's a reason a whole industry has sprung up preaching to programmers the importance of clean code -- it costs hundreds of billions of dollars a year for corporations to make changes to their codebases. The cost of programming hubris -- from un-needed complexity, to undetected or difficult to track down bugs -- goes undiagnosed, but is certifiably real. Trying to save money by spending a little bit more time upfront is almost always worth it. Similarly, practicing compassion towards the needs of others tends to foster the ability to be more compassionate with yourself.

## Object Oriented Programming Basics

Apex is a **statically typed**, object-oriented language. What does that mean, practically? It means that all constructs that you create extend from an abstract type, `Object` - which has two methods on it, both of which can also be _overridden_ by you (more on overriding later):

- equals (allows you to say things like: `the letter a does not equal the letter b`)
- hashCode (should return the same value each time it is called during an object's lifetime, does not need to be unique, but determines an object's uniqueness in a Set/Map collection)

A programming language is statically typed if all objects within the code have a known type while the code is running. Putting the two together, we can create objects - or distinct _instances_ of a type:

```java
public class Foo {
    // you now have created a template
    //for objects corresponding to type Foo
    //Foo is a child of the base Object class
    //as we will see below
}

//All objects have types.
//You can get the type instance for an object
//by calling ".class" after its name, or through
//the method Type.forName('Foo')
Type fooType = Foo.class;
System.debug(fooType.hashCode());
System.debug(new Foo().hashCode());
```

Running those statements in an Anonymous Apex console window (yes, you can create classes within Anonymous Apex!) produces:

```bash
USER_DEBUG [6]|DEBUG|70822
USER_DEBUG [7]|DEBUG|1827246551
```

You'll notice that the hashCode for the instance of the Foo object is substantially smaller than that of an actual instance of Foo, which is produced through the use of the `new` keyword. In object-oriented languages, you create (or initialize, or instantiate) objects through the use of the keyword `new` -- this "calls" (or invokes) the **constructor** of an object. If a constructor is not defined for an object, the object uses a **default constructor** to create itself.

Without a constructor, you lack a way to initialize values to sensible defaults:

```java
public class SpecialNumber {
  //this object now has a property
  //called Number
  public Integer Number;
}

//produces a null-reference exception - ouch!
new SpecialNumber().Number.format()
```

With a constructor, you can do things like set up sensible defaults for your object's properties:

```java
public class SpecialNumber {
  //the constructor ALWAYS
  //has the same name as the class
  public SpecialNumber() {
    //"this." is optional
    //later we'll review why I prefer
    //the use of "this" in classes
    this.Num = 0;
  }

  public Integer Num;
}

//prints '0'
new SpecialNumber().Number.format();
```

By default, all objects have a **zero-argument constructor**; once you have defined a constructor for your object, though, it no longer has a zero-argument constructor by default:

```java
public class SpecialNumber {
  //you might even test
  //that the number coming is null
  //and fall-back to a sensible default
  //but in general, we try to avoid complex logic
  //within constructors
  public SpecialNumber(Integer num) {
      this.num = num;
  }
  public Integer Num;
}

//aw jeez, we just produced another error, this time for ...
SpecialNumber somethingSpecial = new SpecialNumber();
//Constructor not defined: [SpecialNumber].<Constructor>()
```

But you can always bring back your zero-argument constructor -- an object can have as many constructors as you'd like:

```java
public class SpecialNumber {
  public SpecialNumber() {
      this.num = 0;
  }
  public SpecialNumber(Integer num) {
      this.num = num;
  }
  public Integer Num;
}

//this works just fine
SpecialNumber somethingSpecial = new SpecialNumber();
```

In some languages, you can also define a **destructor** for your object, with defined logic for what to do when that object is garbage collected. Not here, though. Garbage collection is an extremely interesting (and fraught) topic which we won't cover in great detail. Suffice to say, there's a reason that Rust is gaining popularity in the programming world -- when you initialize something, as we just did, when storing an instance of `SpecialNumber` in the variable `somethingSpecial`, Apex now needs to allocate memory for that object. It needs to know when it's safe to _stop_ holding that object in memory. This is one of the reasons why Salesforce has heap size limits for Apex -- it needs to verify that you don't exceed the memory available at a given time in your instance when performing computing. Clearing the available memory of unused objects? That's garbage collection. Let's move on.

### The Importance Of Encapsulation (Accessors: Public/Private)

One of the central tenets in object-oriented programming is that objects encapsulate their internals. What does that mean, practically? It means that the programmer is averse to letting users of their object -- even if that user is the same person who wrote the code for the object in question -- reference things that they shouldn't outside of it. In our `SpecialNumber` example, we've just committed the cardinal sin, therefore, of exposing the `Num` property. We've also failed to signal intent, by virtue of poor naming. Let's fix both of those things:

```java
public class EmployeeFacts {
  public EmployeeFacts() {
    this.DaysOffAllowance = 0;
  }

  public Integer DaysOffAllowance { get; private set; }
}
```

Now we're getting somewhere. By changing the name to something associated with our company/client's _domain_, we're making the code accessible not only to ourselves, in the moment of writing it, but to users and stakeholders years down the line. It doesn't take a genius to figure out, without knowing anything about programming, that this object is going to be used to store data about employees. Communicating intent through the use of good names is one of the hardest things we can do when writing code.

In truth, defining a property on a class by simply giving it a type and name is equivalent to this syntax:

```java
public Integer DaysOffAllowance { get; set; }
```

The "get/set" syntax defines how the property is _accessed_. The "public/private" keywords denote _who_ can access. The "**private** set" example now makes it impossible for other consumers of the `EmployeeFacts` object to update the stored value for the `DaysOffAllowance` property; a "private" accessor says "no!" to being referenced outside of the object it's within. When something is **public**, it can be seen and accesssed by any other class or code (in the same namespace, but more on that later).

**Getters** and **setters**, as they're known, are very versatile manipulators of _object members_ (we sometimes refer to properties on an object as its "members", or "member variables", or "instance variables"). But in order to proceed further, we need to introduce methods, or functions. Let's look at the function syntax for getters/setters, using what's known as a "backing variable", and the fairly dense syntax:

```java
//in EmployeeFacts
//the "_p" stands for private
//this used to be fairly commonplace in Java codebases
//in C#, variables can start off with an underscore
//and you see a lot of _privateVariableNaming
private Boolean hasDaysOff() {
  if(DaysOffAllowance_p < 5) {
    return false;
  }
  return true;
}

private Integer DaysOffAllowance_p;
public Integer DaysOffAllowance {
  get {
    if(hasDaysOff()) {
      return DaysOffAllowance_p;
    } else {
      return 0;
    }
  }
  set {
    DaysOffAllowance_p = value;
  }
}
```

There's a lot going on here -- and the syntax is fairly awful to look at. Methods either return a type, using the keyword `return`, or they are defined as `void` -- they return nothing. You can "capture" what's returned from a method by setting a variable of the same type (or a type further up the object chain, more on that in a bit) equal to it. Thus, these two things are functionally equivalent to one another:

```java
private Boolean hasDaysOff() {
  if(DaysOffAllowance_p < 5) {
    return false;
  }
  return true;
}

public Integer DaysOffAllowance {
  get {
    //this time we'll store a reference
    //to the variable and THEN use it
    Boolean hasDaysOff = this.hasDaysOff();
    if(hasDaysOff) {
      return DaysOffAllowance_p;
    } else {
      return 0;
    }
  }
  set {
    DaysOffAllowance_p = value;
  }
}
```

You don't _have_ to store the return value for a function -- you _do_ have to avoid setting something equal to a void method. The compiler won't let you do this:

```java
private void doThings() {
  //do stuff here
}

private Boolean otherMethod() {
  //this won't compile!
  Boolean someValue = this.doThings();
}
```

Something to take note of is the "value" referenced in the "set" method: **value** is a special keyword that in this case means "whatever's being passed to DaysOffAllowance."

This is one of the few instances where Apex is assuredly more powerful than its Java-underpinnings, as we can dispense with the backing variable entirely:

```java
private Boolean hasDaysOff() {
  if(DaysOffAllowance < 5) {
    return false;
  }
  return true;
}

public Integer DaysOffAllowance {
  get {
    if(hasDaysOff()) {
      //here you can refer to the variable name itself
      return DaysOffAllowance;
    } else {
      return 0;
    }
  }
  set;
}
```

We can also introduce the **ternary** expression, which allows you to use conditional logic to return different things. The ternary syntax is defined by an expression like such `conditional that evalates to true or false ? value if true : value if false`:

```java
private Boolean hasDaysOff() {
  return DaysOffAllowance < 5 ? false : true;
}

public Integer DaysOffAllowance {
  get {
    return hasDaysOff() ? DaysOffAllowance : 0;
  }
  set;
}
```

That's a lot better. Even if you knew nothing about programming, if you knew that the company you were working for didn't let you take days off until you had 5 days saved up, you could look at this code and glean some of its meaning. I used this particular example to introduce the concepts of:

- member variables
- "backing" variables (not really needed in Apex)
- methods / functions: void methods, return types
- the importance of naming
- accessors (public / private)

### Namespacing

In other programming languages, code is typically bundled into separate folders and **namespaced** -- if code is in the same namespace, objects are unique and can't share the same name; if they're in different namespaces, two objects can share the same name. In some languages (like JavaScript) the namespace is really the structure of all the folders, and use of files elsewhere in the system relies on them being imported via relative filepath. In something like C#, the namespace is declared at the top of the class declaration:

```csharp
//in C#, you don't have the full
//library available to you
//rather, you import references by namespace
//when you need to make use of different library
//components
using System;
using System.Collections.Generic;

namespace SalesforceObjects {
  public class SalesforceAccount {
    public string Name { get; set; }
    public List<Datetime> SomeOtherProperties { get; set; }
  }
}

```

With Apex, all of your code is either stored in `src/classes/` or `src/triggers/` and no namespacing is available to you. On the one hand, it's nice that you have access to the entire library's list of standard functions and classes without having to import them; on the other, it would be extremely nice to have the use of more folders to organize your code into different business domains, class types, etc ...

### Use Of The "This" Keyword

When you see a reference to **this** in Apex code, it represents the current object in its entirety. Within an object, I prefer to reference all methods that are non-static (more on that in a second) with the use of the keyword **this** so that I know, 100% for sure, which methods are part of the object's class declaration.

Take this example, a slight branching from what I typically give with people when talking about the use of the [Factory Pattern in Apex](/dependency-injection-factory-pattern):

```java
public class Handler {
  public Handler(Factory factory) {
    //install dependencies needed in the handle method
  }

  public void handle(List<SObject> records) {
    //do something with the records
  }
}

//more on abstract classes in a moment!
public abstract class Factory {
  public static Handler getSObjectHandler() {
    return new Handler(this);
  }
}
```

Painting broad brush-strokes here: because the `Factory` passes itself through the use of **this**, the `Handler` class can make use of _all_ the Factory's public methods when setting itself up.

## Inheritance (Class and Method Decorations)

OK, so we've established that all classes in Apex descend from the base `Object`, and that they _inherit_ two methods from Object: `equals` and `hashCode`. When a class inherits from another class, it is said to _extend_ that class. The basic `Object` inheritance is special, in that it does not need to be declared, but we can observe the effects of that inheritance within Apex easily:

```java
//when you don't know
//the type of something
//object is ALWAYS allowed
//because everything descends from it
Account acc = new Account();
Object accountObject = acc;
System.debug(accountObject.equals(acc));
//outputs "true" - after all, "accountObject"
//and "acc" have the same reference
//you can also call acc.hashCode() to verify it
//has access to the Object class's methods
System.debug(accountObject instanceof Object);
//outputs "true", of course!
```

Inheritance as a concept is an extremely important part of the DRY (don't repeat yourself) toolbelt that developers wield. By defining common sets of behaviors for your objects, you consolidate similar operations into statically typed groups of objects. I've spoken about how this kind of consolidation occurs in prior posts, but to be clear: refactoring, or the process of rewriting code to bundle commonalities while implementing new features, is the _best_ time to find these commonalities and increase code re-use/reduce code repetition through the use of inheritance. Refactoring itself is made safe by having broad test coverage for your business logic -- in itself, a topic for another day, but if you're interested in learning more about how crucial well-written tests will feature in your ability to quickly identify commonalities and make changes without fear of introducing bugs, I would encourage you to explore the other posts in [The Joys Of Apex](/).

### Inheritance Basics: Casting Objects To A Specific Type

So, every object in the system descends from `Object` and can be _cast_ to `Object` as a result. When we cast a variable in Apex, there are two directions that casting can go:

- upwards: if you are casting a class to Object or something further up its inheritance chain, you don't need to use parantheses to accomplish the cast. The compiler _knows_ that each instance of an Salesforce `Account` object inherits from the Salesforce `SObject` (more on that in a second), so it's fine letting you cast a child class to a parent type (all the way up to the biggest parent of all, `Object`)
- downwards: if you have an `SObject` that you _know_ is an Account, you can tell Apex to cast it to an Account by the use of parantheses. You would want to do this if you wanted to access fields on the Account without using the `.get` method on SObjects

So, for example:

```java
Account acc = new Account();
SObject castAccount = acc; //works
//much later on in your code ...
//we'll use a method to demonstrate
//that if you only have access to the SObject
//but you safely know the type, you can downcast
private void updateAccountName(SObject castAccount) {
  Account acc = (Account)castAccount;
  //now we can safely accesss acc.Name for setting
  acc.Name = 'some new name';
  //we could also have done this WITHOUT casting
  //through the use of the .put method available on SObjects
  //like castAccount.put(Account.Name, 'some new name');
}
```

Downcasting is particularly prevalent in Apex due to the lack of _generics_ in the language. With generics, you can safely define helper methods that help you iterate through lists and other types of collections prior to returning the exact type you'd like. If that sentence didn't make sense, that's OK -- I'll show you an example of why downcasting might be useful by demonstrating a helper method that pretty much everybody should be using:

```java
//I keep this in a class called CollectionUtils
public static Map<Id, SObject> convertToMap(List<SObject> sObjectList, SObjectField fieldName) {
    Map<Id,SObject> mapping = new Map<Id,SObject>();
    for(SObject sObj : sObjectList) {
        if(sObj.get(fieldName) == null) continue;
        //some people like to use validation that the SObjectField
        //that's been passed in can actually be cast to an Id field
        //that's a good idea, but this is a simple example
        mapping.put((Id)sObj.get(fieldName), sObj);
        //here we had to cast to Id because the method
        //SObject.get always returns an Object!
    }
    return mapping;
}
```

> :Tabs
>
> > :Tab title= Inheritance Notes
> >
> > The reason methods like this are so appealing within Apex is because the compiler knows, via inheritance, that a `List<Account>` is _also_ a `List<SObject>`. Many times in Apex we receive Lists back from SOQL queries that are strongly-typed as a specific Salesforce object, and we need to relate instances of that object to another SObject by way of a lookup field. Creating a map where the key is the lookup field in question is crucial to your success in being able to perform complicated logic between two different types of SObjects.
>
> > :Tab title= Inheritance Footnotes
> >
> > Indeed, I would advise going further than this helper method and also having one that creates Maps keyed by String or Id to Lists of SObjects, crucial when processing data with a one-to-many relationship

### So What Exactly _Is_ An SObject?

All programming languages come with a standard library. Apex is no exception, adding onto Java's standard library (sometimes in spectacularly helpful ways, like within the [String Class](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_methods_system_string.htm)). Some libraries leave their classes open to be extended (our next topic!); others allow you to use their objects but disallow inheritance. These closed off classes are known as **sealed** classes. You can imagine that somewhere in Salesforce's code repository lives something like the following declaration:

```java
//global - like public, but even more accessible
//more on abstract in a second!
global abstract sealed class SObject {
  global Object get(SObjectField field) {
    return this.get(field.getDescribe().getName());
  }

  global Object get(String fieldName) {
    return this.sobject.get(fieldName);
  }
  //etc ...
}
```

That means we get the use of the SObject, which all Salesforce objects are extended from. Or perhaps it's an interface, which all objects inherit from. In either case, we can interact with the methods on the SObject class/type ... but we cannot inherit/extend them. Let's take a walk on the wild side of object inheritance:

### Making Objects Inherit: Interfaces, Abstract/Virtual Classes & The Protected Keyword

So how does one make a parent object which is later inherited from? There are two ways that inheritance can be accomplished within object-oriented programming:

- through the use of **interfaces**, which have a Type but no instances; with an interface, you declare a common set of behavior through methods, and all objects conforming to the bounds of that interface have to have _publicly_ accessible methods matching their interface. In some programming languages, interfaces can define property names and default method signatures, but in Apex, you can only declare the name, return type, and arguments supplied to your methods. An interface is inherited from by use of the **implements** keyword in a class, and a class can inherit from as many interfaces as you'd like (by comma separating the interface names when declaring the class)
- through the use of an **abstract** class. An abstract class _cannot_ be instantiated through the use of the **new** keyword. If you try to do so, you'll get a compiler error. An abstract class, like an interface, can declare methods; unlike an interface, however, an abstract class can define method bodies, and child classes can either access the abstract methods (or not) depending on the visibility level of the methods. A child class can access its parent class's method if that method is denoted as **protected** or **public**. Child classes _cannot_ access **private** methods of their parent class, though a child class's code may interact with **private** parent methods if a method with public/protected accessibility on the parent class interacts with a private method on the parent class. An abstract class can be inherited from in a child class through the use of the **extends** keyword, and a class can only be the extension of one parent class. If an abstract class defines a constructor, classes extending from it must use the **super** keyword, as well as any constructor arguments defined in the parent class, as the first thing done in their own constructor. Failure to do so will lead to a compiler error.
- through the use of a **virtual** class. A virtual class differs from an abstract one primarily in the sense that it can be instantiated through the **new** keyword. Otherwise, it conforms to the behavior described above

Let's look at an example of an interface:

```java
//while I'm not crazy about the "I"
//nomenclature for interfaces, because Apex lacks
//namespacing, it can be a useful way to distinguish
//interfaces from "concrete" objects
public interface IPerson {
  //interfaces don't declare visibility
  //modifiers on their methods
  String getName();
}

public class ContactWrapper implements IPerson {
  //more on the "final" keyword later
  private final Contact con;
  public ContactWrapper(Contact con) {
    this.con = con;
  }

  public String getName() {
    return this.con.FirstName + ' ' + this.con.LastName;
  }
}

public class LeadWrapper implements IPerson {
  private final Lead lead;
  public LeadWrapper(Lead lead) {
    this.lead = lead;
  }

  public String getName() {
    return this.lead.FirstName + ' ' + this.lead.LastName;
  }
}

Lead lead = new Lead(FirstName = 'Test', LastName = 'Lead');
Contact con = new Contact(FirstName = 'Test', LastName = 'Contact');

IPerson leadWrapper = new LeadWrapper(lead);
IPerson conWrapper = new ContactWrapper(con);

//outputs "Test Lead"
System.debug(leadWrapper.getName());
//outputs "Test Contact"
System.debug(conWrapper.getName());
```

Notice the use of the **implements** keyword, and that methods defined in an interface must have _at least_ **public** visibility. (I say at least because technically there is a visibility _above_ public, **global**, which means that a class can be accessed from any namespace / external code. We won't get into **global** here, though).

Notice, also, that though we know the child types of the Contact/LeadWrappers, we can safely set them to `IPerson` instances because they both inherit from the interface.

An example like this dovetails nicely into talking about abstract classes, since the implementation of the `getName()` method on each of the wrappers is essentially the same. Let's look at what this would look like making use of an abstract class. For now, we'll keep the interface (just to show you that you can):

```java
public abstract class Person implements IPerson {
    private final SObject person;
    //notice the use of the protected keyword
    //this means that only classes inheriting from
    //this class have the use of this constructor
    //you can also make methods protected
    protected Person(SObject person) {
      this.person = person;
    }

    public String getName() {
      return String.valueOf(
        this.person.get('FirstName') +
        ' ' +
        this.person.get('LastName')
      );
    }

    //abstract methods don't declare bodies
    //their implementation must be defined in all
    //classes extending from this one
    public abstract String getUniqueIdentifer();

    //more on static methods in a second
    public static Person make(Lead lead) {
      return new LeadPerson(lead);
    }

    public static Person make(Contact con) {
      return new ContactPerson(con);
    }

    //classes cannot be protected
    private virtual class ContactPerson extends Person {
      protected ContactPerson(SObject contact) {
        //calling "super" means "call the
        //class I am derived from"
        super(contact);
      }

      public override String getUniqueIdentifier() {
        //this could be some specific set of business logic
        //unique to all of your org's contacts
        //I'm putting something nonsensical here
        //purely to demonstrate how these methods are defined
        return String.valueOf(this.hashCode());
      }
    }

    private virtual class LeadPerson extends Person {
      protected LeadPerson(SObject lead) {
        super(lead);
      }
      public override String getUniqueIdentifier() {
        //again, just an example
        return String.valueOf(this.hashCode() + 'Lead');
      }
    }
  }
```

There's a lot to discuss here:

- the use of nested classes -- a common object-oriented paradigm when _encapsulating_ business logic. A caller, or client, of this code does not need to know that there are classes called "ContactPerson" and "LeadPerson" -- all they really need to know is that the `Person` class has two **static** methods on it that can be called to initialize a `Person`, or an `IPerson` (since Person is implementing that interface), and that they have access to a method called `getName`. Note -- an object can have as many inner classes as you desire, but inner classes themselves cannot define inner classes at all. Inner classes are great when your object is small and you want to keep everything self-contained, but if a file is breaking 100+ lines of code, you shold consider breaking your inner classes out into separate files
- the `ContactPerson` and `LeadPerson` objects must be defined as **virtual** in order to call their parent class's constructor using the **super** keyword. They are _not_ **abstract** because we are creating instances of them
- **abstract** methods are defined using the **override** keyword on all child classes
- **final** properties can _only_ be declared with an assignment where they are declared, or within an object's constructor. Unless you absolutely have to, it should be in your practice to declare all properties as final; in general, we want to avoid mutating an object's properties from within its methods. When mutations do occur, it's considered a best-practice to always return a new instance of an object with the change made on the new instance. This is a delicate topic amongst object-oriented developers, and particularly within Apex exceptions to this rule do exist; for example, it's considered to be fairly routine to modify properties on your SObjects without returning new instances of them
- **Static** methods are called without a specific instance of an object -- they are available (following their visibility modifier) within a class (but cannot be referenced by something like `this.make` for this example), or from elsewhere for public static methods:

```java
//in Person.cls
//calling make is done like such:
Contact con;
IPerson person = make(con);

//outside of Person.cls
Contact con;
IPerson person = Person.make(con);

//using "this" with a static method won't compile:
//in Person.cls
Contact con;
this.make(con); // won't compile
```

Specifically, **static** methods cannot be used in conjunction with the **new** keyword; because they are not tied to a specific instance of an object, they cannot reference member variables or non-static methods.

### A Prelude to Polymorphism

Your code will benefit tremendously in terms of organization and lack of repetition through the use of inheritance. Objects typically arise out of your own ability to recognize patterns between disparate areas in your codebase. I've worked for some orgs where there were extremely long inheritance chains between objects, and orgs that kept it simple with only a few objects extending/inheriting from one another. Different strokes, as they say.

What does a longer object chain look like in Apex? Let's find out by going back to `IPerson`:

```java
public interface IPerson {
  String getName();
}

//interfaces can extend from other interfaces(!)
public interface IDealBreaker extends IPerson {
  String getDealBreakerReason();
}

//in Person.cls
public static DealBreakerPerson make(Lead lead, String dealBreakerReason) {
  return new DealBreakerPerson(lead, dealBreakerReason);
}

//public since the "make" method references it
//could still be private if the "make" method instead returned IDealBreaker
//"extends" ALWAYS comes before "implements"
public virtual class DealBreakerPerson
  extends LeadPerson
  implements IDealBreaker {
  private final String dealBreakerReason;
  protected DealBreakerPerson(Lead lead, String dealBreakerReason) {
    super(lead);
    this.dealBreakerReason = dealBreakerReason;
  }

  public String getDealBreakerReason() {
    return this.dealBreakerReason;
  }
}
```

Let's test(!) that everything works as expected, first with some anonymous apex, then in an actual test class (our first example test class!):

```java
IPerson lead = Person.make(new Lead());
IDealBreakerPerson leadWithDealBreakerReason =
  Person.make(new Lead(), 'Contract too expensive');

//works, because every instance of IDealBreakerPerson
//is also an instance of IPerson
leadWithDealBreakerReason.getName();
//doesn't work, LeadPerson doesn't implement getDealBreakerReason
lead.getDealBreakerReason();
//works
leadWithDealBreakerReason.getName();

//and then in actual tests:
@isTest
private class PersonTests {
    static Lead lead = new Lead(FirstName = 'Test', LastName = 'Person');

    @isTest
    static void it_should_return_name_for_lead_person() {
        IPerson person = Person.make(lead);

        System.assertEquals('Test Person', person.getName());
    }

    @isTest
    static void it_should_return_name_for_contact_person() {
        IPerson person = Person.make(
          new Contact(FirstName = 'Test', LastName = 'Contact')
        );

        System.assertEquals('Test Contact', person.getName());
    }

    @isTest
    static void it_should_return_name_and_dealbreaker_reason_for_dealbreaker_lead() {
        String dealBreakerReason = 'Contract too expensive';
        IDealBreaker dealbreakerLead = Person.make(lead, dealBreakerReason);

        System.assertEquals('Test Person', dealbreakerLead.getName());
        System.assertEquals(dealBreakerReason, dealbreakerLead.getDealBreakerReason());
    }
}
```

Running the tests produces the following:

```bash
[pass] PersonTests: it_should_return_name_and_dealbreaker_reason_for_dealbreaker_lead, time: 0.027s
[pass] PersonTests: it_should_return_name_for_contact_person, time: 0.005s
[pass] PersonTests: it_should_return_name_for_lead_person, time: 0.006s
```

> :Tabs
>
> > :Tab title= The Tests Pass!
> >
> > Yum. Who doesn't love a nice passing test? But let's take it a step further. Let's say that management wants to receive a special alert for Leads who fall out with certain keywords left by Sales in the Lead's description field
>
> > :Tab title= Footnote
> >
> > This is a stretch, for sure, but I'm trying to keep things simple for the purpose of these examples. You could actually imagine something like this taking place, with slightly different bounds; for example, wanting automation if a task was logged against a closed lead containing certain words

```java
public interface ISpecialDealBreaker extends IDealBreaker {
    Boolean isVIPLead();
}

//in Person.cls
public static ISpecialDealBreaker makeSpecial(Lead lead, String dealBreakerReason) {
  return new SpecialDealBreakerPerson(lead, dealBreakerReason);
}

//updating the visibility of the stored
//person to protected so that SpecialDealBreakerPerson
//has access to it
protected final SObject person;
protected Person(SObject person) {
  this.person = person;
}

//class declarations can get a little
//verbose with inheritance, it's true,
//but the benefits you gain more than make up for it!
public virtual class SpecialDealBreakerPerson
  extends DealBreakerPerson
  implements ISpecialDealBreaker {
  protected SpecialDealBreakerPerson(Lead lead, String dealBreakerReason) {
    super(lead, dealBreakerReason);
  }

  public Boolean isVIPLead() {
    //use of the ternary to make this operation always safe
    Lead lead = (Lead)this.person;
    List<String> descriptionWords = lead.Description != null ?
      lead.Description.split(' ') :
    Boolean hasMatch = false;
    for(String descriptionWord : descriptionWords) {
        //typically, so-called "magic" strings that indicate something
        //of business significance are declared as public static final Strings
        //so that your test classes can use the same "magic" string in their setup
        //avoid non-constant strings unless you have absolutely no other choice
        if(descriptionWord.equalsIgnoreCase('SPECIALKEYWORD')) {
            hasMatch = true;
            //"break" is a special keyword in loops
            //that exits the loop early
            //this is a performance optimization -
            //once we know a match exists
            //we don't need to keep searching for
            //other matches
            break;
        }
        //you could keep going with this logic
        //testing different keywords
    }
    return hasMatch;
  }
}
```

And then in the tests, we should verify that `getName` is still callable by this now-grandchild instance of `ISpecialDealBreaker`, and that each method works as advertised:

```java
//in PersonTests.cls
@isTest
static void it_should_return_name_dealbreaker_reason_and_vip_status() {
  String dealBreakerReason = 'Some other reason';
  ISpecialDealBreaker specialLead = Person.makeSpecial(lead, dealBreakerReason);

  System.assertEquals('Test Person', specialLead.getName());
  System.assertEquals(dealBreakerReason, specialLead.getDealBreakerReason());
  System.assertEquals(false, specialLead.isVIPLead());

  lead.Description = 'something something SPECIALKEYWORD something';
  //this works because the REFERENCE to the lead
  //is still the same in the wrapper!
  System.assertEquals(true, specialLead.isVIPLead());
}
```

And the tests pass! We have access to the grandparent's methods from a grandchild instance.

I hope you can see from this (admittedly limited) example that inheritance and encapsulation can be combined to produce truly powerful results, putting business logic firmly into well-understood nomenclatures and keeping the messy parts contained (encapsulated) within objects.

One last note on the keyword **virtual**: when used with methods, a method can be both an **override** and **virtual**, as in `public virtual override Boolean myMethodName()` -- this indicates that a method is both implementing a method from an abstract/virtual class "above" it in the hierarchy, while _also_ allowing classes that inherit from it to also override the implementation defined here.

## The Power Of Polymorphism

So, we've learned about objects and how they can extend/inherit from one another with interfaces, abstract, and virtual classes. We've also learned about visibility and how to properly encapsulate the business logic within objects so that consumers of those objects get exactly what they need, and nothing more. We've learned about the importance of naming, and how to make code understandable to virtually anyone.

Perhaps you've heard a lot about polymorphism, and how you're supposed to use it to your advantage. To put it plainly, polymorphism means using the basic types of your objects instead of peering into their internals in order to figure out what to do.

First, here's an example of something that's procedural code making use of our `Person` object:

```java
//in some class
public void processPersons(List<Person> persons) {
  for(Person person : persons) {
    if(person instanceof Person.SpecialDealBreakerPerson) {
      //don't process the VIPs
      continue;
    } else if(person instanceof Person.DealbreakerPerson) {
      Person.DealBreakerPerson dealBreaker = (Person.DealBreakerPerson)person;
      dealBreaker.markAsDealBrokenAndProcessed(System.now());
    } else if(person instanceof Person.LeadPerson) {
      Person.LeadPerson leadPerson = (Person.LeadPerson)person;
      leadPerson.markLeadAsProcessed(System.now());
    } else if(person instanceof Person.ContactPerson) {
      Person.ContactPerson contactPerson = (Person.ContactPerson)person;
      contactPerson.markAsProcessed(System.now());
    }
  }
}
```

Without even seeing the internals of the methods like `markAsDealBrokenAndProcessed` and `markLeadAsProcessed`, you should be able to recognize that we're in a spot of trouble here. Imagine coming back to this code years down the line and trying to divine what was going on. You have some conditional logic that relies on the composition of the individual objects in a list, and depending on what type they are, you're going to do a whole host of things. Let's use the power of polymorphism to set this situation right:

```java
//in Person.cls

public virtual void process(Datetime processTime) {
  //here we use a string instead of an SObjectField
  //because we want both the Lead and Contact
  //to make use of the same field!
  this.person.put('ProcessTime__c', processTime);
}

//...
public virtual class DealBreakerPerson
  extends LeadPerson
  implements IDealBreaker {
  private final String dealBreakerReason;
  protected DealBreakerPerson(Lead lead, String dealBreakerReason) {
    super(lead);
    this.dealBreakerReason = dealBreakerReason;
  }

  //here we have to use virtual AND override so that
  //SpecialDealBreakerPerson can bail out
  public virtual override void process(Datetime processTime) {
    //cool story - you can call "super"
    //in virtual methods to opt-in to the parent's behavior
    //prior to doing your own thing
    super.process(processTime);
    //assuming we have a custom field set up
    //to track DealBreakers in particular
    this.lead.DealBroken__c = true;
  }
  //...
}

//...
public virtual class SpecialDealBreakerPerson
  extends DealBreakerPerson
  implements ISpecialDealBreaker {
  protected SpecialDealBreakerPerson(Lead lead, String dealBreakerReason) {
      super(lead, dealBreakerReason);
  }

  //by leaving this method signature blank
  //we are borrowing from the Null Object pattern
  //look it up, it's worth it!
  public override void process(Datetime processTime) {}
  //...
}
```

Going back to our procedural code, it now looks fairly tame:

```java
public void processPersons(List<Person> persons) {
  Datetime processedTime = System.now();
  for(Person person : persons) {
    person.process(processedTime);
  }
}
```

Boom! If you need to check this code years down the line, or (heaven forbid!) make changes to it, the business logic for processing people of different business specifications is now completely encapsulated within their respective classes. This minimizes the chance for bugs by reducing procedural code (**if** statements and **case** statements being where the vast majority of bugs that I have personally encountered derive from), and it also helps to properly categorize things.

## The Transient Keyword

You won't see **transient** used often, until you do. A property on an object can be marked as transient in order to avoid being serialized:

```java
public class DataTransferObject {
  //will show up when serialized
  public Person Person { get; set; }
  //this property is hidden upon serialization
  public transient Integer VersionNumber { get; set; }
}
```

**Serialization**, or the mechanism by which an object is turned into a String version of itself, is commonly seen when interacting with external APIs. It's also a way for you to get clever with Apex's insistence that **@future** methods only accept simple types, like Strings (for more on that, take a look at the post on [Callouts / Callbacks](/future-method-callout-callback/) that I wrote!!). If you don't work with external APIs often, or don't need to hide data from those APIs, there's a good chance you will _never_ use the **transient** keyword!

## Wrapping Up

Well, we've really experienced it all together! We've gone from examining the origin of the "object" part of "object-oriented programming" to seeing firsthand how polymorphism can properly encapsulate business logic within classes. At this point, I'd love to recommend some additional resources for those of you beginning your Apex journey.

The three books I benefitted most from reading when I started out:

- [Clean Code](https://smile.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882/)
- [The Art Of Unit Testing](https://smile.amazon.com/Art-Unit-Testing-examples/dp/1617290890)
- [Test Driven Development By Example](https://smile.amazon.com/Test-Driven-Development-Kent-Beck/dp/0321146530)

Perhaps some of you are surprised that Dan Appleman's book, [Advanced Apex Programming](https://smile.amazon.com/Advanced-Apex-Programming-Salesforce-Appleman/dp/1936754126/) doesn't make the list. Here's why -- I think Advanced Apex Programming is great. It's held up remarkably well, even as Salesforce's platform has evolved. It doesn't teach the fundementals, though, or why the fundementals are important. For that, I think the classic texts associated with object-oriented programming cover crucial teaching ground!

Hopefully for those of you looking to get into Apex, or searching for a deeper understanding of concepts taught in a simple way, this proves to be a helpful resource for you. I'd like to thank you for taking the time to learn alongside me, and I hope that you'll check out other entries in [The Joys Of Apex](/)! If you'd like to persuse the code from this post, please feel free to explore further via my [ApexMock's Github branch for object-oriented programming basics](https://github.com/jamessimone/apex-mocks-stress-test/tree/object-oriented-basics/).
