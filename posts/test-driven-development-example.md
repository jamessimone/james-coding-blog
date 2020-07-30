> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Test Driven Development (TDD) Example

> :Author src=github,date=2020-05-03T15:12:03.284Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

This series has spent quite a bit of time talking about Test Driven Development (TDD), and has shown many examples along the way. Now I'd like to take a step back; to return to the roots of TDD, both to show why it can be such an effective development strategy, and also to review the fundementals.

Test Driven Development is guided by the belief that your tests should be self-documenting; that they should be the best place for a new developer to start learning the code base, by assimilating the expectations that the business has in the form of well structured and asserted-for tests. The general workflow when following TDD correctly makes use of the following pattern:

- Red (you write a failing test. Code that fails to compile also counts as a failing test)
- Green (your tests pass)
- Refactor (you took some artistic liberties while doing the initial implementation. Now it's time to clean the code up)

Correct use of this pattern also passively presents an ancillary principle: that the tests should run fast. Because you're encouraged to move quickly through the cycle, from implementing a failing test to getting the test(s) to pass, to implementing the next piece of acceptance criteria in your feature, you have to be able to move quickly in order to be able to iterate effectively. Detractors of TDD often point to the stringent "write a failing test before producing production-level code" policy as hamstringing developers; proponents _know_ that in addition to simplifying the creation of new code by pursuing only making a new test pass, TDD excels when quickly iterating on new functionality, because the existing code coverage you generate makes it easy to change the code you already have with complete confidence. Let's dive in and see how TDD leads from the inception of a feature request to a fully working feature.

## The Feature Request

Your company/client comes to you with a new feature request. Right away, you're cautious — this is clearly entirely new functionality. There won't be any overlap with existing code, or at least none that you can foresee initially. Finance & Sales have teamed up to rework the Stages for existing Opportunities to get assigned their Probabilities using a secretive new forecasting model. In order to test out the effectiveness of the new model, they want to perform a split-test without informing the sales reps that some of their Opportunities are going to be withdrawn. In addition to holding a small percentage of Opportunities in the forecasting control group, they need the "old" Probability scores to be mapped to a new custom field on the Opportunity; there'll be a one-time data mapping necessary to this new field, and then the Probabilities assigned to the Opportunity stages will be updated to reflect the new model.

This is meant to sound familiar. What follows probably isn't — but that's the nature of feature requests. Because they're specific to the client/business, I'm instead going to focus on how to solve a problem, rather than going with something siloed to a specific industry. The feature request looks something like this:

> With the new Opportunity probabilities, some of them will be updated using a workflow rule to assign the probability to an anti-prime number. When you see an Opportunity get updated with one of these sentinel Probability scores, you'll need to unassign the existing Opportunity owner and reassign to a system user, as well as map the prior Probability to the new custom field.

## Building An Anti-Prime Generator

First of all — what's an "anti-prime" number? An anti-prime is defined as a number that can be divided by more numbers than any of the numbers before it (in other words: a number with more factors than any number before it). Since we're operating on a percentage scale for Probability, that means we'll chiefly be concerned with all of the anti-primes from 0 to 100. Let's begin!

TDD states that lack of code, or lack of code that compiles, counts as a failing test. The first thing we'll need to do is create the object that we'd like to house this business logic in, and define a well-named method that returns true/false:

```java | classes/AntiPrime.cls
public class AntiPrime {
  public static Boolean isAntiPrime(Integer num) {
    return false;
  }
}
```

That gives us the wings we need to confidently start down the road towards testing this feature:

```java | classes/AntiPrimeTests.cls
@isTest
private class AntiPrimeTests {
  @isTest
  static void it_should_detect_one_as_an_antiprime() {
    System.assertEquals(true, AntiPrime.isAntiPrime(1));
  }
}
```

Now we have a failing test to work with, and we can begin implementing out this feature. The naive implementation makes no assumptions:

```java | classes/AntiPrime.cls
public class AntiPrime {
  public static Boolean isAntiPrime(Integer num) {
    return num == 1 ? true : false;
  }
}
```

Now the first test passed, but we know there are at least several other anti-prime numbers out there below 100. For anti-primes, 1 is the first number because: `1/1 = 1`. That means, as well, that in order for the next number to compete with 1 as the next anti-prime in the sequence, it has to have _two_ divisors. Time to write another failing test, and then perhaps we'll be able to refactor ...

```java | classes/AntiPrimeTests.cls
@isTest
static void it_should_detect_two_as_an_antiprime() {
  System.assertEquals(true, AntiPrime.isAntiPrime(2));
}
```

Now we are back to the "Red" part of our TDD workflow, and we need to re-assess how we're going to get to green. Clearly, the simplest case is again the best way:

```java | classes/AntiPrime.cls
public class AntiPrime {
  public static Boolean isAntiPrime(Integer num) {
    if(num == 1 || num == 2) {
      return true;
    }
    return false;
  }
}
```

Now both our tests pass, but we're left with the sneaking suspicion that it's time to refactor; the reason for this is because we're now using two "magic" numbers — 1 and 2 — to represent the anti-primes, but we actually want to programmatically assign them. Time to go back to the drawing board:

```java | classes/AntiPrime.cls
public class AntiPrime {
  public static Integer primesBeforeDefault = 100;

  public static Boolean isAntiPrime(Integer num) {
    return antiPrimesBefore.contains(num);
  }

/*if you try to use the simpler singleton
pattern here, e.g. antiPrimesBefore = getAntiPrimes(),
it's fine for calls to isAntiPrime,
but the set will be double initialized
when testing against getAntiPrimes();
you also won't be able to reset
primesBeforeDefault*/
  private static final Set<Integer> antiPrimesBefore {
    get {
      if(antiPrimesBefore == null) {
        antiPrimesBefore = getAntiPrimes();
      }
      return antiPrimesBefore;
    }
    private set;
  }

  private static Set<Integer> getAntiPrimes() {
    Integer potentialAntiPrime = 1;
    Integer divisorCount = 0;
    Set<Integer> antiPrimes = new Set<Integer>();
    while(potentialAntiPrime <= primesBeforeDefault) {
      Integer localDivisorCount = 0;
      for(Integer potentialDivisor = 1;
        potentialDivisor <= potentialAntiPrime;
        potentialDivisor++) {
        if(Math.mod(
          potentialAntiPrime,
          potentialDivisor
        ) == 0) {
          localDivisorCount++;
        }
      }
      if(localDivisorCount > divisorCount) {
        divisorCount++;
        antiPrimes.add(potentialAntiPrime);
      }
      potentialAntiPrime++;
    }
    return antiPrimes;
  }
}
```

Now there's just one "magic" number — the `primesBeforeDefault` pseudo-constant. Introducing it has accomplished three things:

- allowed the logic behind generating the anti-primes to flow much better
- introduced a new edge-condition that needs to be tested for; that of calling `AntiPrime` with a number larger than the anti-primes that were lazily loaded
- created a means to test for numbers above 100 through the use of a static integer

```java | classes/AntiPrimeTests.cls
@isTest
static void it_should_throw_exception_if_number_larger_than_anti_primes_generated_is_passed() {
  AntiPrime.primesBeforeDefault = 100;
  Exception e;
  try {
    AntiPrime.isAntiPrime(200);
  } catch(Exception ex) {
    e = ex;
  }

  System.assertNotEquals(null, e);
}

@isTest
static void it_should_work_with_numbers_greater_than_100() {
  AntiPrime.primesBeforeDefault = 120;
  System.assertEquals(true, AntiPrime.isAntiPrime(120));
}
```

And in `AntiPrime`:

```java | classes/AntiPrime.cls
public static Boolean isAntiPrime(Integer num) {
  if(num > primesBeforeDefault) {
    throw new AntiPrimeException('Primes weren\'t generated to: ' + num);
  }
  return antiPrimesBefore.contains(num);
}

//....
public class AntiPrimeException extends Exception {}
```

Now it's time to continue with the tests to ensure that all of our expected anti-primes are being generated correctly. Let's raise the visibility of the `getAntiPrimes` private static method to see what's currently being output:

```java | classes/AntiPrime.cls
@testVisible
private static Set<Integer> getAntiPrimes() {
//..
}

//and in AntiPrimeTests.cls ...
@isTest
static void it_should_properly_generate_anti_primes_below_sentinel_value() {
  //make no assumptions!
  AntiPrime.primesBeforeDefault = 100;
  System.assertEquals(
    new Set<Integer>{ 1, 2, 4, 6, 12, 24, 36, 48, 60 },
    AntiPrime.getAntiPrimes()
  );
}
```

Aaaaand the test fails. Examining the output, it seems I've introduced an unintended bug during my refactor. Did you spot it? You see, 72 and 60 both have 12 divisors ... but I messed up when incrementing the `divisorCount` variable. It shouldn't just be _incremented_ when the `localDivisorCount` variable is greater than the last divisor count — it should be _set equal to the localDivisorCount_. Otherwise, both 60 and 72 end up qualifying because the prior divisor count is 10 when 60 is reached:

```java | classes/AntiPrime.cls
@testVisible
private static Set<Integer> getAntiPrimes() {
//...
  if(localDivisorCount > divisorCount) {
    divisorCount = localDivisorCount;
    antiPrimes.add(potentialAntiPrime);
  }
  potentialAntiPrime++;
//...
}
```

Now the tests all pass. At this point, because you deterministically know the values for the anti-primes below 100, you could definitely make the argument that the first two tests — testing for specific values — should be deleted.

You could also make the case that the second one should instead be modified to test for the _last_ value below 100 (in other words, that 60 is correctly detected). I would go down the latter path, knowing that the test for `getAntiPrimes` was covering the other cases.

### An Aside On Anti-Prime Number Generation

It's true that [solving the anti-prime formula](https://rosettacode.org/wiki/Anti-primes) is easier in some other languages with more expressive/fluent array features. However, examining the presented solutions, I would advise you to keep readability _and_ performance in mind. Most of the submitted answers treat `1` (and, occasionally, `2` as well) as a special case, whereas I was more concerned with showing how to treat all numbers equally — although you can certainly make the argument that `0` is not treated particularly equally in any of the solutions, mine included.

Code style is a contentious topic, and I don't mean to present my implementation as the preferred solution. In reality, there is no way to avoid two iterations in a Java-like language when building the solution; however, your taste and preferences in regards to `for` or `while` loops could entirely (and understandably) differ from mine. I use `while` loops infrequently, though if you've read my [Writing Performant Apex Tests](/writing-performant-apex-tests/) post, you'll know that they frequently out-perform the plain-jane `for` loops.

That said, the only improvement I think improves the legibility of the above solution would be if Apex supported range-based array initializations, which would make the inner iteration in `getPrimes` more expressive by simplifying the `for` loop. Writing code — even code that needs to be extremely performant — always requires achieving a suitable balancing act between readability and performance.

As a counterpoint, take a look at the F# example in the provided link ... sure, it _works_, but what if it didn't?!

## Completing The Feature Request

The rest of the feature request falls much more in line with our pre-existing code (and is omitted, as a result). We can see that we're going to need to need to call `AntiPrime` from within our Opportunity Handler's before update method, assign the old probability to the hidden custom field, and re-assign the owner to our placeholder owner if the new probability is anti-prime.

A finished pull request for this feature will end up including:

- the new custom field metadata
- permission set (and/or) profile related changes for this field
- AntiPrime and its tests
- the updates to the OpportunityHandler and the tests for OpportunityHandler
- the workflow rule, if such things are version-controlled (hopefully they are) in your/your client's org

## Test Driven Development Is Your Friend

Hopefully you can see how the "red, green, refactor" mindset can help you to quickly iterate on new and existing features. Having the safety net of your tests helps provide feedback on your system's design as it grows over time. Writing tests also helps you to focus on the single smallest step you can take as you develop to "get to green." Though it's true that in some big refactors, you end up having to rework tests, in general I find that even with large-scale (30+ files) refactors, I rarely have to update tests in a well-designed code base. Rather, the existing tests themselves help me to verify that everything has been successfully re-implemented correctly.

This is also because TDD fits in well with the Object-Oriented Programming paradigm, the "Open Closed Principle," which states:

> Objects should be open for extension but closed for modification

When your building blocks are small and expressive, they can contribute effectively to the larger domain problems without being modified. Similarly, when your tests are small, you're motivated and incentivized to keep your methods small, your public interfaces minimal, and your designs clean. For true "helper" methods like an anti-prime generator, static methods help to keep your code footprint small by minimizing the number of objects you need to initialize and keep track of.

For something like an `OpportunityOwnerReassigner` object, which could encapsulate the decision to reassign an owner based on the opportunity's probability being anti-prime, it's crucial to keep in mind that while this specific feature calls for reassignment by means of the opportunity's Probability field, future requests might expand on the number of fields / the specific owner to consider when making a reassignment. This might even _be_ the future request, which is a perfect example of extending an existing object's responsibilities in light of new requirements.

---

Once again, I'd like to thank you for following along with the [Joys Of Apex](/). The anti-prime problem is a fun little formula to solve for, and there are many different ways the solution could be implemented. I initially started thinking about it following a trivia question on the subject; hopefully it stands in well as an abstract example of what some obscure business logic might end up looking like to an outsider. As well, I hope it proved fun to see how TDD can help you to iterate on a problem in a well-defined way. Till next time!
