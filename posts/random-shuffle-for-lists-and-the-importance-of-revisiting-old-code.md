> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Random Shuffle For Lists & The Importance Of Revisiting Old Code

> :Author src=github,date=2020-11-23T15:00:00.000Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

I had a requirement come up the other day that sent me back to nearly the very beginning of my professional coding life -- selecting random elements out of a list. You've seen a partial excerpt of the code before, if you have read [the article on sorting & performance in Apex](/sorting-and-performance-in-apex). At the time, I was very happy with the pairing of the `Comparator` class (which I will recreate here) with a pseudo-random sort algorithm, allowing me to simply take items off the front of the list till the required random amount was reached. For years, I rarely thought about this code, except in the context of Lead ranking (where it had been used in the first place). Selecting random elements from a list isn't a difficult problem, and I don't present this to you as though it represents the pinnacle of that effort. It's an _interesting_ problem, in my eyes, because it highlights some of the helper methods we might _like_ to have -- helper methods that exist in other languages standard libraries.

Let's look at how you shuffle the elements in a list in Python:

```python
from random import shuffle
x = [[i] for i in range(10)]
shuffle(x)
```

Damn, that's terse. Python's standard library helps to illuminate my points precisely:

1. There's a method for that (randomizing list elements)
2. There's _also_ a method for _that_ (creating a list from either a fixed starting point (0), or a given range)

C# and Java (8+) also do the "range" part quite nicely:

```java
// java
import java.util.*;
List<int> firstTenNumbers = IntStream.range(0, 10).toList();
```

```csharp
// c#
using System.Linq;
List<int> firstTenNumbers = Enumerable.Range(0, 10);
```

But in each of these languages, you have to implement the random sort method yourself. The [Fisher-Yates shuffle](https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle) is a popular (and easy to implement) shuffle; there are _plenty_ of other random sort methods around, as well.

## Revisiting The Old Random Shuffle Code

My original random shuffle code was separated into two pieces:

1. The `Comparator`, which abstracted away the finer points of implementing the `Comparable` interface within Apex
2. The `Randomizer`, which included a pseudo-random sort ("pseudo" because it didn't try to account for bias) as a subclass of `Comparator`, and then returned however many elements had been asked for from the front of the now-randomly sorted list.

Here's that `Comparator` class, again:

```java
public abstract class Comparator {
  public abstract Integer compare(Object o1, Object o2);

  public void sort(Object[] values) {
    ItemWrapper[] wrappedItems = new List<ItemWrapper>();

    for(Object value: values) {
      wrappedItems.add(new ItemWrapper(this, value));
    }

    wrappedItems.sort();
    values.clear();

    for(ItemWrapper item: wrappedItems) {
      values.add(item.value);
    }
  }

  private class ItemWrapper implements Comparable {
    private final Comparator comparer;
    private final Object value;

    public ItemWrapper(Comparator comparer, Object value) {
      this.comparer = comparer;
      this.value = value;
    }

    public Integer compareTo(Object o) {
      return comparer.compare(value, ((ItemWrapper)o).value);
    }
  }
}
```

And the original `Randomizer` code:

```java
public without sharing class Randomizer {
  public static Integer getNumberFromRange(Integer minValue, Integer maxValue) {
    return minValue + (Math.random() * (maxValue - minValue + 1)).intValue();
  }

  public Object[] getRandomSelection(Object[] objectList, Integer selectionNumber) {
      // use clone to retain List type information
      Object[] randomlySortedList = objectList.clone();
      Object[] returnList = objectList.clone();
      returnList.clear();

      new RandomSorter(0, objectList.size() - 1).sort(randomlySortedList);
      for(Integer i = 0; i < selectionNumber; i++) {
          returnList.add(randomlySortedList.get(i));
      }

      return returnList;
  }

  private class RandomSorter extends Comparator {
    private final Integer startingRange, endingRange;
    public RandomSorter(Integer startingRange, Integer endingRange) {
      super();
      this.startingRange = startingRange;
      this.endingRange = endingRange;
    }

    public override Integer compare(Object o1, Object o2) {
      Integer firstRandom = getNumberFromRange(this.startingRange, this.endingRange);
      Integer secondRandom = getNumberFromRange(this.startingRange, this.endingRange);

      if(firstRandom != secondRandom) {
        return firstRandom > secondRandom ? 1 : -1;
      }
      return 0;
    }
  }
}
```

Oof. Have you ever looked at something you wrote years ago and checked git blame to make sure it was _really you_ that could have authored such a travesty? How did this even pass code review? Now, there's a number of things that jump out at me about this code:

1. The unnecessary (and wasteful) allocations -- it really feels like I went crazy with those `.clone()` methods!
2. Using the `Comparator` at all -- it isn't necessary, and the sort just adds to the CPU time
3. The pseudo-"random" nature of the code

But before going further let's look at the test, which actually had some interesting things going on:

```java
@isTest
private class RandomizerTest {
  @isTest
  static void shouldRandomizeElements() {
    // we'll do two things - affirm the output is
    // sufficiently different from the starting elements
    // of the original list, and verify that
    // two output lists don't equal each other
    List<Integer> startingList = new List<Integer>{ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };

    Randomizer randomizer = new Randomizer();
    List<Object> twoRandomDigits = randomizer.getRandomSelection(startingList, 2);

    Type returnedListType = getType(twoRandomDigits);
    System.assertEquals(
      true,
      returnedListType.equals(List<Integer>.class),
      'Returned list was not strongly typed: ' + returnedListType
    );
    System.assertEquals(
      2,
      twoRandomDigits.size(),
      'Only two elements should have been returned'
    );
    System.assertNotEquals(
      startingList.get(0),
      twoRandomDigits.get(0),
      'Random list shouldn\'t begin with same element'
    );
    System.assertNotEquals(
      startingList.get(1),
      twoRandomDigits.get(1),
      'Random list shouldn\'t use same second element'
    );

    List<Object> secondRoundOfDigits = randomizer.getRandomSelection(startingList, 2);
    System.assertEquals(
      2,
      secondRoundOfDigits.size(),
      'Only 2 elements should be returned!'
    );
    System.assertNotEquals(
      twoRandomDigits,
      secondRoundOfDigits,
      'Two random lists should rarely equal each other'
    );
  }

  private static Type getType(Object param) {
    String objectName = '';

    try {
      if(param instanceof Datetime) {
        return Type.forName('Datetime');
      } else {
        // this will always throw
        Object o = (Datetime)param;
      }
    } catch(Exception ex) {
      // yikes
      String message = ex.getMessage().substringAfter('Invalid conversion from runtime type ');
      objectName = message.substringBefore(' to ');
    }

    return Type.forName(objectName);
  }
}
```

I wouldn't use the `getType` function shown in production-level code, but it's a neat trick for testing since we don't get to use the fun stuff like `getType()` in Apex. The test class (by and large) is unedited from the version I wrote years ago -- though I do thank [Jonathan Gillespie](https://github.com/jongpie) for his help in validating that the `clone()` calls are necessary in the `Randomizer`, which led to the type-assertion section above.

Note, as well, that this test isn't meant to be bulletproof. It can (and will) fail at random (ha!) intervals.

## Writing A Better Randomizer For Improved Apex Shuffling

Let's just get rid of the `Comparator` reference altogether -- while it's a standard part of my helper-class arsenal, it's not necessary for this solution. I think it would be easy to say that one of the takeaways in returning to this code is not over-architecting solutions; certainly, I thought about putting that forward as something I learned. But as I thought about writing this article over the course of the last week, I began to find that takeaway disingenuous. Don't paralyze yourself from creation by over-analyzing! Hindsight often makes our mistakes clearer than any amount of planning. Returning to this code gave me ample opportunity to clean things up.

Let's begin (let's also implement some safety checks, care of feedback by Jonathan):

```java
// in Randomizer.cls

public Object[] getRandomSelection(Object[] objectList, Integer selectionNumber) {
  // hello shopkeeper, I'd like ALL your safety checks
  Boolean hasInvalidArguments = objectList == null || objectList.isEmpty() || selectionNumber > objectList.size();
  if(hasInvalidArguments) {
    throw new IllegalArgumentException(
      'Invalid arguments: ' +
      '\nObject list: ' + objectList +
      '\nSelection number: ' + selectionNumber
    );
  }
  // use clone to retain List type information
  Object[] returnList = objectList.clone();
  returnList.clear();

  Integer index = 0;
  Set<Integer> previouslyAccessedIndices = new Set<Integer>();
  while(index < selectionNumber) {
    Integer randomNumber = getNumberFromRange(0, objectList.size() - 1);
    if(previouslyAccessedIndices.contains(randomNumber) == false) {
      previouslyAccessedIndices.add(randomNumber);
      returnList.add(objectList.get(randomNumber));
      index++;
    }
  }
  return returnList;
}
```

Pundits will note that this is, essentially, the naive reverse Knuth/Fisher-Yates shuffle. The bones of the randomization are in place; the spirit is there. Also, you know it's [The Joys Of Apex](/), because there's a `while` loop thrown in for good measure.

You can get better performance if you do the shuffling in-place. Ditching the `returnList` variable (and the `clone()` call) is fine, as long as the order of the elements in the original list didn't matter to begin with. This wouldn't fly if you were needing to select random elements bound to your UI, for example, but it probably suffices in most backend use-cases.

## The Fisher-Yates / Knuth Shuffle In Apex

> "The important thing, once you have enough to eat and a nice house, is what you can do for others, what you can contribute to the enterprise as a whole." - Donald Knuth

You might conclude (perhaps reasonably) that the above code is "good enough", but I'll include the machine-optimal Fisher-Yates / Knuth shuffle for posterity. Note that for our purposes, the shuffling stops once the `selectionNumber` has been reached; to truly randomize the list (and, perhaps, to separate the randomization responsibility from the `pluck` or `range` responsibility), that criteria would be removed:

```java
// in Randomizer.cls
public Object[] getRandomSelection(Object[] objectList, Integer selectionNumber) {
  // ...
  Object[] returnList = objectList.clone();
  returnList.clear();

  Integer index = objectList.size() - 1;
  while(index > 0 && returnList.size() < selectionNumber) {
    Integer randomNumber = getNumberFromRange(0, index);
    returnList.add(objectList.get(randomNumber));
    index--;
  }
  return returnList;
}
```

And that's a wrap! The `Randomizer` stops shuffling as soon as the `selectionNumber` has been reached. The original list retains its purety. The test occasionally fails because, hey, sometimes both the randomized lists have the same elements. Life's like that. To wit -- you can remove the chance of the test being flaky by stubbing out the return value for `getNumberFromRange` with a `@testVisible` private static Map. This gives you the benefit of completely isolating the success of the test; it just comes at the cost of a bit more boilerplate. If you're doing incremental deploys and you were never going to change this code again ... it's probably more hassle than it's worth. If you have to do the occasional full deploy, or always do a full deploy and it takes more than a few minutes for your tests to run ... ya might want to just stub that method out!

## Random Shuffle Wrap-up

In the end, I was glad to get the chance to revisit some old code -- brushing off the cobwebs prior to making use of it once more, this time with an eye toward using the experiences I've had in the meantime (both with sorting and cryptography) to arrive at a more nuanced, bulletproof solution. That the resulting solution is more performant is nice, but not necessary; most _business problems_ can't be solved like this through (only) implementing an algorithm. The rise of patterns, particularly in OOP, is a testament to that statement -- it becomes a matter of best practice when adding functionality to a codebase to do so in a sustainable fashion, and design patterns help with that. In this case, the Fisher-Yates algorithm happened to help, too. If you'd like to look at the source code on GitHub, I've [uploaded the code to my repo](https://github.com/jamessimone/apex-mocks-stress-test/tree/list-shuffle).

I said, earlier, that in prepping to write this article I eventually came to feel it would be disingenuous to say that the takeaway in revisisting the original code I'd written is to avoid over-architecting, and that's true. Still, I wonder what you'll find the takeaway to be, and I'd encourage you to post a comment here, or (perhaps after some reflection of your own) to engage me (@shickading) in discussion on the [SFXD Discord](https://join.sfxd.org/) with your thoughts! Either way, thanks for reading -- whether you say something or not, know that I appreciate you. Till next time!
