> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Building A Better Singleton

In [the last post on Picklist Validation](/picklist-validation/), I touched briefly on my disappointment in being unable to bring to fruition a better pattern for creating singletons -- the perfect way to access constant values like those in a picklist:

> I hate writing singleton property accessors, and have spent more hours than I'd care to admit trying to "solve" that problem through a variety of abstract class hacks ... none of which has borne any fruit. That's the nature of progression, though -- failure is a part of the process.

In the ensuing weeks, I spent a considerable portion of time simply spent bulleting out thoughts about the "problem" that I had first introduced in the [Idiomatic Apex](/idiomatic-salesforce-apex/) post:

- the traditional get/set method for creating singletons takes _nine_ lines of code. NINE. Nine lines! That's way too much.
- because singletons need to be accessed statically (so that you don't have to initialize new objects each time you are calling them), there is an inherent disconnect between the ideal object-oriented solution (which would require the usage of the `this` keyword, strictly verboten in a static context), and our options on the table.
- we can set static variables in our constructors though .... might that be enough?

Last night, while winding down, the situation finally resolved itself in a burst of inspiration. Messily implemented first in my notebook (my handwritten braces get progressively worse), I finally figured out how to resolve the static nature of singletons with an object-oriented approach:

```java
public abstract class Singleton {
  private static final Map<Type, Singleton> typeToSingleton
    = new Map<Type, Singleton>();

  public static Singleton getSingleton(Type type) {
    if(typeToSingleton.containsKey(type) == false) {
      typeToSingleton.put(type, (Singleton)type.newInstance());
    }
    return typeToSingleton.get(type);
  }
}
```

Going back to the `Picklist` class from the [previous post](/picklist-validation/), now the base class just needed to extend `Singleton` so that subclasses could make use of the type:

```java
public abstract class Picklist extends Singleton {
  //...etc
}

public class AccountIndustries extends Picklist {
  public AccountIndustries() {
    super(Account.Industry);
  }

  //the newer invocation
  //note that because there isn't a "set"
  //method, if I wasn't going for mobile
  //friendly code, this could be reduced to a single line
  public static AccountIndustries Current {
    get {
      return (AccountIndustries)Singleton.getSingleton(AccountIndustries.class);
    }
  }

  //the more idiomatic singleton, for testing purposes
  public static AccountIndustries Instance {
    get {
      if(Instance == null) {
        Instance = new AccountIndustries();
      }
      return Instance;
    }
    private set;
  }

  public String AGRICULTURE { get { return this.getValue('Agriculture'); }}
  public String APPAREL { get { return this.getValue('Apparel'); }}
}
```

Of course, it's not enough to simply have code that compiles -- is it performant? Let's do some simple iteration to stress test this new Singleton pattern:

```java
@isTest
private class SingletonStressTests {
  @isTest
  static void it_should_establish_a_baseline_iteration_time() {
    runTest(null);
  }

  @isTest
  static void it_should_use_idiomatic_singleton() {
    runTest(new TestIdiomaticSingleton());
  }

  @isTest
  static void it_should_use_new_singleton() {
    runTest(new TestNewSingleton());
  }

  static void runTest(TestFunction function) {
    for(Integer index = 0; index < 10000; index++) {
      if(function != null) {
        function.call();
      }
    }
  }

  private abstract class TestFunction {
    public abstract void call();
  }

  private class TestIdiomaticSingleton extends TestFunction {
    public override void call() {
      System.debug(AccountIndustries.Instance.AGRICULTURE);
    }
  }

  private class TestNewSingleton extends TestFunction {
    public override void call() {
      System.debug(AccountIndustries.Current.AGRICULTURE);
    }
  }
}
```

Woof. Initial results were not promising:

| TEST NAME                                                    | OUTCOME | RUNTIME (MS) |
| ------------------------------------------------------------ | ------- | ------------ |
| SingletonStressTests.itShouldEstablishABaselineIterationTime | Pass    | 23           |
| SingletonStressTests.itShouldUseIdiomaticSingleton           | Pass    | 240          |
| SingletonStressTests.itShouldUseNewSingleton                 | Pass    | 1160         |

At first, I wondered if perhaps the dynamic `Type.newInstance`, or perhaps even the usage of the internal Map within the `Singleton` class was responsible for the slowdown. I would expect that there would be some slowdown, some overhead, in the usage of this more complicated setup ... however, I did not expect that the new method would be _six times slower_. Of course, in actual usage, such slowdown might not matter for your application ... but that's not the [Joys Of Apex](/) way. While I was ecstatic at the notion of saving 8 lines of code through the use of this new singleton one-liner, I wasn't about to recommend that to my clients if it meant taking such a big performance hit.

I tried eliminating the map. I tried passing an actual instance of the class to the `getSingleton` function (in this case, using `new AccountIndustries`) instead of dynamically spinning an instance up. Nothing. No changes reduced the runtime appreciably.

Then it hit me -- the property `Current` itself was not being cached. Just for kicks, let's switch to the more idiomatic method for instantiating singletons to see if that made up any ground in terms of performance:

```java
public static AccountIndustries Current {
  get {
    if(Current == null) {
      Current = (AccountIndustries)Singleton.getSingleton(AccountIndustries.class);
    }
    return Current;
  }
  private set;
}
```

The results were fascinating:

| TEST NAME                                                    | OUTCOME | RUNTIME (MS) |
| ------------------------------------------------------------ | ------- | ------------ |
| SingletonStressTests.itShouldEstablishABaselineIterationTime | Pass    | 27           |
| SingletonStressTests.itShouldUseIdiomaticSingleton           | Pass    | 109          |
| SingletonStressTests.itShouldUseNewSingleton                 | Pass    | 85           |

OK, so the pattern was not itself responsible for the performance slowdown. That was great news. It wasn't great news that it still took 9 lines of code to retrieve a singleton instance. Apex does feature static constructors, but those are no good; was there any way to ensure that the property was only initialized once without all the boilerplate?

Perhaps you see where this is headed now. There is, of course, one last trick up our sleeves -- the `final` keyword. Traditionally used to ensure an object's dependencies are set only in the constructor, `final` is also compatible with static variables and ensures that they are only ever initialized once.

That makes the `AccountIndustries` object look pretty svelte indeed:

```java
public class AccountIndustries extends Picklist {
  public AccountIndustries() {
    super(Account.Industry);
  }

  public static final AccountIndustries Current = (AccountIndustries)Singleton.getSingleton(AccountIndustries.class);

  //only keeping this property now to re-run the tests
  public static final AccountIndustries Instance = new AccountIndustries();

  public String AGRICULTURE { get { return this.getValue('Agriculture'); }}
  public String APPAREL { get { return this.getValue('Apparel'); }}
  //etc, adding constants as is necessary to
  //represent your picklists values in code
  //with minimal usage of "magic" strings
  //and the added benefit of intellisense
}
```

Running the tests again:

| TEST NAME                                                    | OUTCOME | RUNTIME (MS) |
| ------------------------------------------------------------ | ------- | ------------ |
| SingletonStressTests.itShouldEstablishABaselineIterationTime | Pass    | 23           |
| SingletonStressTests.itShouldUseIdiomaticSingleton           | Pass    | 98           |
| SingletonStressTests.itShouldUseNewSingleton                 | Pass    | 90           |

Easy peasy. I ran the tests dozens of times -- for whatever reason, the newer method was always a few milliseconds faster than simply caching the instance. One can only surmise that there exists some fairly interesting tail-end optimizations in how the compiler assembles the `Type.newInstance` code which gives it a slight edge over the use of the `new` keyword.

## Singleton Pattern Conclusion

Lessons learned in building a better singleton:

- you can have your object-oriented cake and eat it too
- usage of the `final` keyword should be considered the idiomatic method for instantiating singletons

One thing that should be noted with the usage of `Type.newInstance()` -- it requires the usage of a _public_ zero-argument constructor. That shouldn't come as a surprise for those of you following along from the [Factory](/dependency-injection-factory-pattern) post. It _does_ however, fly in the face of the more classic singleton pattern (which makes the constructor private in order to force invocation through the public static variable). That's definitely something to consider when making your object design choices. The limitations of the `Type` class in Apex have frequently proven less-than-ideal in testing, as well, since it requires elevating test classes to public that shouldn't have to have elevated visibility. As always, food for thought.

I hope that this post proved educational for you. The usage of singletons is fairly common, and knowing that you have some tricks up your sleeve when you need to implement one is always a good thing. Till next time!
