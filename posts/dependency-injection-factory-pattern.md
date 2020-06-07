> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Dependency Injection & The Factory Pattern

> :Author src=github

Welcome back to another episode in the continuing Joys Of Apex discussion. In my last post, I covered how to wrap your SFDC DML operations using [Crud / CrudMock](/mocking-dml). As we head into the New Year, let's talk about Dependency Injection (DI) - popularly used to simplify object creation, allow for polymorphic construction of objects, and easily stub out object dependencies while writing tests.

### Intro to Dependency Injection in Apex

But let's take it slow. What does Dependency Injection look like? Let's take some simple Apex examples:

```java
public class AccountWrapper {
    private final Account account;

    public AccountWrapper() {
        this.account = [SELECT Id FROM Account LIMIT 1];
    }
}
```

This is literally the simplest wrapper object possible. But if you ever want to change the reference to the `Account` being stored in the constructor, or mock it for testing the `AccountWrapper`'s functionality, you're going to need to go with another approach -- injecting the `Account` SObject via the constructor:

```java
public class AccountWrapper {
    private final Account account;

    public AccountWrapper(Account account) {
       this.account = account;
    }
}
```

Now, it becomes the object responsible for initializing the `AccountWrapper` to pass in the correct Account reference; this also means that you can easily create a dummy account for your tests when you don't require a specific account to test your wrapper's functionality.

### The Problems with Dependency Injection

Dependency injection thus becomes your one-stop shop, especially when making sensible unit tests, for passing in only the objects your class needs in order to test what you're testing. Dependencies that aren't used on the code path you're testing can be omitted, or mocked through a shared interface or extended mock object. But it wouldn't be Apex without a few roadblocks thrown your way care of Salesforce -- because Apex is compiled by pushing your local classes up to the cloud, you can run into issues where refactoring your existing objects can be made difficult when changing the signature of an object's constructor. Anybody who's ever waded through the dreaded _Dependent Class Is Out Of Alignment_ error when deploying your Apex classes knows that if your objects are all being constructed via the `new` keyword in many different places, correctly refactoring your existing initialization statements to properly match your constructor signature can be ... difficult, or at the very least, time-consuming. Time is precious.

But how can we fix this problem? If we need to dynamically inject classes with other classes at runtime yet still have the flexibility to swap out those dependencies when testing, is there any way to do so?

**Important preamble** -- I have found great success in using the method I am about to describe. If it doesn't float your Object-Oriented Boat, please accept my apologies.

### Using the Factory Pattern In Apex

The [Factory Pattern](https://en.wikipedia.org/wiki/Factory_method_pattern) offers a centralized place where your objects are constructed. Typically, the Factory ends up looking something like this:

```java
public abstract class Factory {
    public static AccountWrapper getAccountWrapper() {
        return new AccountWrapper(
            //ruh roh, we still have this hard-coded dependency somewhere
            //more on that later
            [SELECT Id FROM Account LIMIT 1]
        );
    }
}
```

And whenever you need to initialize the `AccountWrapper`:

```java
//some code, somewhere, that needs the wrapper
AccountWrapper wrapper = Factory.getAccountWrapper();
```

What are the benefits of this approach? Well, now our "client" code (so-called because it is the consumer of initialized `AccountWrappers`) doesn't need to know how the object is constructed; it's agnostic of the wrapper's dependencies, which can change without having to refactor all of the places using the object. But things still aren't ideal. Initializing the objects within the Factory has brought about the centralization of how your objects are being constructed ... but the Factory itself now runs the risk of becoming extremely bloated. We'd like for the Factory to be responsible for object initialization without having to know exactly what each object needs. That way, it expands in size only so much as you need to create objects, instead of exponentially as your object's dependencies change and increase. Luckily ... there's a way.

### The Factory Pattern & Constructor Injection

Let's take our Factory example in Apex and improve it, slightly:

```java
public virtual class Factory {
    public virtual Account getAccount() {
        return [SELECT Id FROM Account LIMIT 1];
    }

    public virtual AccountWrapper getAccountWrapper() {
        return new AccountWrapper(this);
    }
}

public class AccountWrapper {
    private final Account account;

    public AccountWrapper(Factory factory) {
        this.account = factory.getAccount();
    }
}
```

Wowza. The Factory stays slim, expanding only as you add new objects to your codebase; the responsibility for construction still lies with the object, and it always has access to the dependencies it needs! That's pretty cool. You can also stub out the `getAccount` method, should you need to fake your account dependency in tests. Even nicer, if the `getAccount` method is one used frequently in tests, you can also centralize your overrides in a shared test file.

But let's bring it back to our [Crud example](/mocking-dml):

```java
public virtual class Factory {
    public ICrud Crud { get; private set; }

    private static Factory factory;

    @testVisible
    protected Factory() {
        this.Crud = new Crud();
    }

    public static Factory getFactory() {
        //production code can only initialize the factory through this method
        if(factory == null) {
            factory = new Factory();
        }

        return factory;
    }

    public static BusinessLogicThing getBusinessLogicThing() {
        return new BusinessLogicThing(this);
    }

    @testVisible
    private Factory withMocks {
        get {
            this.Crud = new CrudMock();
            return this;
        }
    }
}

//your production code
public class BusinessLogicThing {
    private final ICrud crud;

    public BusinessLogicThing(Factory factory) {
        this.crud = factory.Crud;
    }

    public void handleBusinessLogic(List<Account> accountsNeedingBusinessLogicDone) {
        this.updateAccountValues(accountsNeedingBusinessLogicDone);
        this.crud.doUpdate(accountsNeedingBusinessLogicDone);
    }

    private void updateAccountValues(List<Account> accounts) {
        for(Account acc : accounts) {
            //do business stuff here
            //for now let's set some silly value
            acc.Name = acc.Name + ' New';
        }
    }
}

//your test code
@isTest
private class BusinessLogicThing_Tests {
    @isTest
    static void It_Should_Update_Accounts_Correctly() {
        //Given
        String testString = 'Test';
        Account fakeAccount = new Account(Name = testString);

        //When
        BusinessLogicThing bizLogic = Factory.getFactory().withMocks.getBusinessLogicThing();
        bizLogic.handleBusinessLogic(new List<Account>{ fakeAccount });

        //Then
        Account updatedAccount = (Account) CrudMock.Updated.Accounts.singleOrDefault;
        System.assertEquals(testString + ' New', updatedAccount.Name);
    }
}
```

### Summing up Dependency Injection & The Factory Pattern In Apex

So what happened here? The Factory in Apex got initialized with the production level Crud wrapper - and in the production level code, we know that the Crud's `doUpdate` method is going to correctly update Accounts run through the BusinessLogicThing. But in the _tests_, we can completely avoid having to hit the database and the subsequent requerying to verify that the Account Names have been updated accordingly. We can simply go to our mock and verify that:

- the Account has been put into the correct list
- there's only one of them (the `singleOrDefault` method will throw an exception if, as a result of the called code, more than one record exists in the list)
- the Name property has been updated, as we expect

That's the power of the Factory Pattern when used with Dependency Injection. Typically, test slowness is the result of the Salesforce database being hit. So far in the Joy Of Apex, we've covered one possible approach to hitting the database -- through DML operations like record creation, upserting, updating, deleting, or undeleting.

There is _another_ side to test slowness, though -- accessing the database through querying. In an upcoming episode in this ongoing series, I'll cover how you can use the **Repository Pattern** similarly to our Crud implementation to hot-swap out querying the database while in tests. And once we've covered the Repository ... that's it. There have been some voicing the opinion that this code is a lot of boilerplate; on the contrary, I find that organizations making use of these files typically save on lines of code, test complexity, and developer overhead. That last point is particularly important, and I'd like to give a short explanation:

Without the use of fancy tooling (and I am aware that there are some tools out there to do this, but so far the Salesforce sponsored tooling for VSCode is still kind of disappointing for non-DX orgs), onboarding new developers or consultants to an existing Salesforce.com project often involves hours and hours of head's-down code-digging, particularly to understand how objects are constructed. In an ideal world, where we would have access to niceties like Visual Studio's running count of how many times and where objects are being used, this would be less of an issue; but, considering that most developers are either clinging close to MavensMate/Sublime or VSCode and some combination of VSCode plugins, giving developers a one-stop-shop for where objects are initialized helps to familiarize them with the codebase and object interplay much faster.

Here's to hoping you enjoyed this episode of The Joys Of Apex. More to come in 2020 -- for now, wishing you all a Happy New Year!

PS -- I did some stress testing on the use of the CrudMock / Crud class I am recommending versus the FFLib Apex Mocks library which was developed by Andrew Fawcett, who worked on FinancialForce prior to working for Salesforce. FinancialForce's approach closely aligns with that of Mockito, one of the pre-eminent Java mocking solutions, and as such is widely accepted in the industry as the de-facto way to approach mocking within Apex. I will also be covering this in a future post, but for now if you are curious, [check out the project on my Github](https://github.com/jamessimone/apex-mocks-stress-test) for a sneak peek of the relative performance merits for each library. Cheers!
