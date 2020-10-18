> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Sorting And Performance In Apex

> :Author src=github,date=2020-03-22T15:12:03.284Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

Recently, a reader came to me, wanting to discuss the potential performance implications of using the [DML mocking framework](/mocking-dml) I have been espousing here:

> Please stop claiming performance on something that isn't doing the same thing as FFLib. Additionally, in test (sic) you're not sorting, so using your Crud implementation to actually insert is going to be slower than directly inserting, anywhere from n log n to n^2 slower.

I always find it endearing when the formulas come out. As a small business owner, I want to ensure that my clients are getting the best in the way of performance; to some extent, that's what I'm selling, but beyond that, I also consider it a moral obligation to separate feelings from code. My point is not to recommend things to people because I _feel_ they are right. Rather, the whole point of this series has been to show using TDD and _numbers_ that if you want big improvements in your test time, you can follow the methodology I'm describing (more so than any actual piece of code) to reduce the length of time it takes for your unit tests to run.

When I talk about the use of the [Factory pattern](/dependency-injection-factory-pattern) as a way to use dependency injection to give your classes access to DML methods that can then be easily mocked, my intent is to show one possible way to utilize this _methodology_. As a good friend of mine likes to say:

> The best line of code is the one never written.

So ... don't make sweeping changes if you don't have to. Empower yourself through an education in what's possible to decide how to best make positive changes in your/your team's development. Reducing testing time (thus speeding iteration) is one possible means to that end.

## Stress Testing The Crud Implementation

With that being said, I thought that beyond the language this reader in question chose to employ, their underlying assertion was an interesting one, and something that should be tested. To refresh your memory, I'll post just the relevant snippets:

```java | classes/Crud.cls
//these days, on a greenfield project,
//I'd really call this class DML
public virtual class Crud implements ICrud {
  @testVisible private static Integer MAX_DML_CHUNKING = 10;
  //....
  public virtual List<SObject> doInsert(List<SObject> records) {
    this.sortToPreventChunkingErrors(records);
    Database.insert(records);
    return records;
  }
  //etc, sortToPreventChunkingErrors is called
  //in update/upsert as well

  private void sortToPreventChunkingErrors(List<SObject> records) {
    //prevents a chunking error that can occur if
    //SObject types are in the list out of order.
    //no need to sort if the list size is below the limit
    if(records.size() >= MAX_DML_CHUNKING) {
        records.sort();
    }
  }
}
```

But is the production usage of `Crud` _actually_ causing `O(n log n)` (linearithmic) to `O(2^n)` (quadratic) slowness? This seems like something that we can test fairly easily. Of course, to test "in production" (mais c'est en fait "in situ", non?), we have access to the wonderful world of Anonymous Apex. Let's build something that allows us to test the reader's assertion, getting a baseline performance indication from what happens when calling `Database.insert` in order to compare against the `Crud` implementation.

Our pseudo test-runner needs the following qualities:

- ability to compute start/end time of each transaction
- prevention of actual commits to the database (this is production, after all!)
- means for each test to hook into the above while implementing its own database insertion

It's also not enough to test one of the `Crud` methods against only the baseline `Database.insert` method; I also need to update the implementation to make sorting optional so that I can measure whether or not adding sorting significantly affects processing time:

```java | classes/Crud.cls
public virtual class Crud implements ICrud {
  public static Boolean SORT_CHUNKS = false;
  //....
  private void sortToPreventChunkingErrors(List<SObject> records) {
    //prevents a chunking error that can occur
    //if SObject types are in the list out of order.
    //no need to sort if the list size is below the limit\
    if(SORT_CHUNKS && records.size() >= MAX_DML_CHUNKING) {
        records.sort();
    }
  }
}
```

Alright, let's look at the Anonymous Apex:

```java
public abstract class Function {
  private Datetime now = System.now();

  protected abstract void call();
  protected abstract String getTypeName();

  public Function() {
    Savepoint sp = Database.setSavePoint();
    this.recordTime('Starting for ' + getTypeName());
    this.call();
    this.recordTime('Ending for ' + getTypeName());
    Database.rollBack(sp);
  }

  protected List<Account> getAccounts() {
    List<Account> accounts = new List<Account>();
    //despite each Database.rollback
    //the DML rows still count towards the max
    //of 10,000 DML rows per sync transaction
    //and we need to give breathing room
    //for the max of 10 seconds
    //per Anonymous Apex transaction
    for(Integer index = 0; index < 2000; index++) {
      accounts.add(
        new Account(
            Name = 'Test' + Math.random(),
            NumberOfEmployees = index,
            Phone = String.valueOf(index),
            Sic = '57340',
            YearStarted = String.valueOf((Math.random() * 4).intValue())
          )
      );
    }
    return accounts;
  }

  protected void recordTime(String startString) {
    System.debug(startString + ': ' + getSecondsPassed() + ' seconds elapsed');
    now = System.now();
  }

  private Integer getSecondsPassed() {
    return Datetime.newInstance(System.now().getTime() - now.getTime()).second();
  }
}

public class DatabaseInsert extends Function {
  protected override String getTypeName() { return 'Database.insert'; }

  protected override void call() {
    Database.insert(this.getAccounts());
  }
}

public class DMLFunctionWithSorting extends Function {
  protected override String getTypeName() { return 'Crud (with sorting)'; }

  protected override void call() {
    Crud.SORT_CHUNKS = true;
    new Crud().doInsert(this.getAccounts());
  }
}

public class DMLFunctionNoSorting extends Function {
  protected override String getTypeName() { return 'Crud (no sorting)'; }

  protected override void call() {
    Crud.SORT_CHUNKS = false;
    new Crud().doInsert(this.getAccounts());
  }
}

new DatabaseInsert();
new DMLFunctionWithSorting();
new DMLFunctionNoSorting();
```

> :Tabs
>
> > :Tab title= Function Class
> >
> > A few notes on the `Function` paradigm for the footnotes, and running that whole block in Anonymous Apex yields:
>
> > :Tab title= Function Footnote
> >
> > The `Function` paradigm was inspired by an article I read recently on [fluent iterators](https://nebulaconsulting.co.uk/insights/list-processing-in-apex/), which is well worth the read. I've been digging through their source code and having fun with it. There's so much good food for thought in their codebase, which is linked in the article! I've also since published a post about [Lazy Iterators](/lazy-iterators) which you may also find interesting.

```bash
  USER_DEBUG [24]|DEBUG|Starting for Database.insert: 0 seconds elapsed
  USER_DEBUG [24]|DEBUG|Ending for Database.insert: 9 seconds elapsed
  USER_DEBUG [24]|DEBUG|Starting for Crud (with sorting): 0 seconds elapsed
  USER_DEBUG [24]|DEBUG|Ending for Crud (with sorting): 8 seconds elapsed
  USER_DEBUG [24]|DEBUG|Starting for Crud (no sorting): 0 seconds elapsed
  USER_DEBUG [24]|DEBUG|Ending for Crud (no sorting): 8 seconds elapsed
```

_Très intéressant_, as they say. I ran this snippet a few times just to make sure that my eyes weren't deceiving me — with the same results.

To get better granularity (and to prevent rounding errors) on the seconds elapsed, let's swap out those `getSecondsPassed` Integers for Decimals:

```java | AnonymousApex Function.cls
protected void recordTime(String startString) {
  System.debug(startString + ': ' + getSecondsPassed().format() + ' seconds elapsed');
  now = System.now();
}

private Decimal getSecondsPassed() {
  Integer millisecondsPassed = Datetime.newInstance(
    System.now().getTime() - now.getTime()
  ).millisecond();
  return Decimal.valueOf(millisecondsPassed) / 60;
}
```

> :Tabs
>
> > :Tab title= A Small Caveat
> >
> > A few notes on the `Function` paradigm for the footnotes, and running that whole block in Anonymous Apex yields:
>
> > :Tab title= Notes On Testing In Apex
> >
> > This is true for many languages, but you have to run things many times in order to get something approximating consistent results. I ran just the _decimal formatted_ test more than 30 times, and the test results varied _wildly_ between runs. I consistently found that the native insert method lagged behind the Crud method, with or without sorting, but at times the seconds difference between each invocation varied so much as to render the results unstudyable; at times, the _sorting_ method was fastest. This is the infuriating nature of data science - trying to achieve consistency across things that are by nature inconsistent.

```bash
#test run 32 ...
USER_DEBUG [32]|DEBUG|Starting for Database.insert: 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Database.insert: 11.783 seconds elapsed
USER_DEBUG [32]|DEBUG|Starting for Crud (with sorting): 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (with sorting): 6.833 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Crud (no sorting): 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (no sorting): 6.45 seconds elapsed
#test run 31 ...
USER_DEBUG [24]|DEBUG|Starting for Database.insert: 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Database.insert: 5.15 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Crud (with sorting): 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (with sorting): 8.317 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Crud (no sorting): 0 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (no sorting): 4.867 seconds elapsed
#test run 30 ...
USER_DEBUG [24]|DEBUG|Starting for Database.insert: 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Database.insert: 11.817 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Crud (with sorting): 0 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (with sorting): 1.933 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Crud (no sorting): 0 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (no sorting): 3.783 seconds elapsed
#test run 29 ...
USER_DEBUG [24]|DEBUG|Starting for Database.insert: 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Database.insert: 2.15 seconds elapsed
USER_DEBUG [32]|DEBUG|Starting for Crud (with sorting): 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (with sorting): 11.867 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Crud (no sorting): 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (no sorting): 4.783 seconds elapsed
#test run 28 ...
USER_DEBUG [24]|DEBUG|Starting for Database.insert: 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Database.insert: 14.067 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Crud (with sorting): 0 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (with sorting): 4.533 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Crud (no sorting): 0 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (no sorting): 13.833 seconds elapsed
#test run 27
USER_DEBUG [24]|DEBUG|Starting for Database.insert: 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Database.insert: 3.15 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Crud (with sorting): 0 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (with sorting): 0.4 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Crud (no sorting): 0.017 seconds elapsed
USER_DEBUG [32]|DEBUG|Ending for Crud (no sorting): 1.417 seconds elapsed
#.... etc
```

I could keep going. Anybody can run these test at home though, so I hardly think it necessary. Out of my 30+ sample size test runs, let's take the 6 results above and do some tabulation & classic statistical modeling:

| Method            | Tabulation         | Value       |
| ----------------- | ------------------ | ----------- |
| Database.insert   | Average            | 8.0195      |
| Database.insert   | Standard Deviation | 5.12941099  |
| Crud (sorting)    | Average            | 5.647166667 |
| Crud (sorting)    | Standard Deviation | 4.237680895 |
| Crud (no sorting) | Average            | 5.8555      |
| Crud (no sorting) | Standard Deviation | 4.245394293 |

The 95% confidence interval (2.3723 ± 6.05222962) comparing `Database.insert` to the sorting method results in a range from 0 - 8.42456362 with a standard error of 2.72. The `sort` method isn't even close to operating in quadratic / linearithmic time. Given that the sorting average is within the first standard deviation for not sorting, most statisticians would probably just throw their hands up and give up the comparison entirely.

In other words, there's no significant performance degradation with the use of the baseline `Crud` library. Indeed, in the vast majority of instances, it compares favorably with the baseline implementation, even if sorting is used. Statistically speaking, any performance degradation (if it did occur) isn't even close to significance, but _generally_ speaking, it's likely that your production performance bottleneck isn't going to be determined by how you insert/update/upsert things; it's going to be determined by how efficient the handler(s) you have that are called by said actions.

> :Tabs
>
> > :Tab title= Notes On FFLib
> >
> > To be clear — you can do a lot more with the FFLib library. My point in writing this whole series has not been to villify FFLib — it's been to contend that if the vast majority of testing time is sunk into DML, you might not _need_ to mock every other dependency that you have, and that if the use of those mocks doesn't actually measurably speed up your testing time, you'd be better off not using the library at all. Merely mocking queries/DML will save you huge increments of time with a much smaller mocking footprint. Focusing on small changes that produce big wins is a _proven_ success strategy, and I hope that you'll be encouraged by these results to think about how you can optimize your/your team's development accordingly.
>
> > :Tab title= FFLib Footnote
> >
> > Using an example relying on a string field, as per the original answer on the Salesforce Stack Exchange, is brilliant, by the way. Most other fields you'd want to sort on, assuming that your custom sorting depended on only one field at all, don't have access to a built-in method to provide the 1, -1, or 0. There's no "compareTo" for Dates, or Datetimes, for example.

## Implementing Custom Sorting In Apex

One of the big takeaways from the above is that the default sorting implementation in Apex, at least for SObjects, is absurdly performant. That's really good news. But what happens if you need to sort your SObjects very specifically?

Moving on to another interesting subject — custom sorting. Some of you may recall that in the footnotes for the Joys Of Apex post on [Enums](/enum-apex-class-gotchas), I spoke about the `Comparable` interface in Apex, part of the standard library for Apex. To review, classes looking to implement `Comparable` have to conform to the following contract:

```java
//where the Integer returned
//should be either:
//-1 for less than, 1 for greater than
//or 0 for functionally equivalent
global Integer compareTo(Object compareTo);
```

### An Example Comparable Implementation Online

There's a fairly well-viewed Salesforce stack exchange post on [creating a Comparator class](https://salesforce.stackexchange.com/questions/95671/apex-equivalent-of-java-comparator), the accepted answer for which features an .... object-oriented-lite ... version of a way to easily implement custom sorting within Apex. I'm going to show you the code that is suggested there, and then massage it to be more idiomatic. On the subject of performance, however, both implementations feature placeholder-lists, which is presumably the source for much of the performance overhead when it comes to using a custom sorter.

The original answer:

```java || classes/Comparator.cls
//I've posted the entirety of the response, unedited:
public abstract class Comparator {
    public abstract Integer compare(Object o1, Object o2);
    public static void sort(Object[] values, Comparator comp) {
        //  Obtain the list type of values
        Object[] temp = values.clone();
        temp.clear();
        //  Helper class for sorting using Comparable
        Helper[] tempValues = new Helper[0];
        for(Object value: values) {
            tempValues.add(new Helper(comp, value));
        }
        //  Perform sort
        tempValues.sort();
        //  Extract values back into temp list
        for(Helper helper: tempValues) {
            temp.add(helper.value);
        }
        //  And set the list to the new, sorted order
        values.clear();
        values.addAll(temp);
    }
    //  Simply calls Comparator when asked.
    class Helper implements Comparable {
        Comparator method;
        Object value;
        Helper(Comparator comp, Object val) {
            method = comp;
            value = val;
        }
        public Integer compareTo(Object o) {
            return method.compare(value, ((Helper)o).value);
        }
    }
}

//From here, you can create your own solutions:

public class AccountNameComparator extends Comparator {
    public override Integer compare(Object a, Object b) {
        return ((Account)a).name.compareTo(((Account)b).name);
    }
}

//Which would let you sort as you like:
Account[] accounts = [SELECT Name FROM Account ORDER BY CreatedDate LIMIT 5];
Comparator.sort(accounts, new AccountNameComparator());
```

### Joys Of Apex Suggested Comparable Implementation

One of the things that I try to stress here is the importance of naming. Using names like `Helper` doesn't tell anybody what you're up to. Likewise, the use of a static method on `Comparator` is kind of a bummer. Let's _encapsulate_ the sorting behavior, rename things, and expose a better interface using the same example of sorting by Account name [^5]:

```java | classes/Comparator.cls
public abstract class Comparator {
  public abstract Integer compare(Object o1, Object o2);

    public void sort(Object[] values) {
      Object[] temp = new List<Object>();
      ItemWrapper[] wrappedItems = new List<ItemWrapper>();

      for(Object value: values) {
        wrappedItems.add(new ItemWrapper(this, value));
      }

      wrappedItems.sort();

      for(ItemWrapper item: wrappedItems) {
        temp.add(item.value);
      }

      values.clear();
      values.addAll(temp);
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

//same as before
public class AccountNameComparator extends Comparator {
    public override Integer compare(Object a, Object b) {
        return ((Account)a).Name.compareTo(((Account)b).Name);
    }
}

//much cleaner
Account[] accounts = [SELECT Name FROM Account ORDER BY CreatedDate LIMIT 5];
new AccountNameComparator().sort(accounts);
```

By passing the `Comparator` instance using the `this` keyword, we completely eliminate the static method and instead allow consumers of custom sorting to simply define their sorting algorithm in a class extending `Comparator` prior to calling the `sort` method with their list. That's properly object-oriented.

Let's revisit our `Function` class to observe whether or not custom sorting is really going to bite us in production:

```java | Anonymous Apex Function.cls
//with getAccounts() set to return 10,000 rows
public class BaselineSorting extends Function {
  protected override String getTypeName() { return 'Baseline sorting'; }

    protected override void call() {
    List<Account> accounts = this.getAccounts();
    accounts.sort();
  }
}

public class CustomSorting extends Function {
  protected override String getTypeName() { return 'Custom sorting'; }

    protected override void call() {
    List<Account> accounts = this.getAccounts();
    new AccountNameComparator().sort(accounts);
  }
}

new BaselineSorting();
new CustomSorting();
```

Answer — it depends, but probably yes. Again, there's quite a bit of variance in run times:

```bash
#Run 5
USER_DEBUG [24]|DEBUG|Starting for Baseline sorting: 0.017 seconds elapsed
USER_DEBUG [24]|DEBUG|Ending for Baseline sorting: 5.067 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Custom sorting: 0 seconds elapsed
USER_DEBUG [24]|DEBUG|Ending for Custom sorting: 15.25 seconds elapsed

#Run 4
USER_DEBUG [24]|DEBUG|Starting for Baseline sorting: 0.017 seconds elapsed
USER_DEBUG [24]|DEBUG|Ending for Baseline sorting: 4.617 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Custom sorting: 0.017 seconds elapsed
USER_DEBUG [24]|DEBUG|Ending for Custom sorting: 16.017 seconds elapsed

#Run 3 (what happened here?!)
USER_DEBUG [24]|DEBUG|Starting for Baseline sorting: 0.017 seconds elapsed
USER_DEBUG [24]|DEBUG|Ending for Baseline sorting: 5.433 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Custom sorting: 0.017 seconds elapsed
USER_DEBUG [24]|DEBUG|Ending for Custom sorting: 1.317 seconds elapsed

#Run 2
USER_DEBUG [24]|DEBUG|Starting for Baseline sorting: 0 seconds elapsed
USER_DEBUG [24]|DEBUG|Ending for Baseline sorting: 4.8 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Custom sorting: 0.017 seconds elapsed
USER_DEBUG [24]|DEBUG|Ending for Custom sorting: 14.467 seconds elapsed

#Run 1
USER_DEBUG [24]|DEBUG|Starting for Baseline sorting: 0 seconds elapsed
USER_DEBUG [24]|DEBUG|Ending for Baseline sorting: 6.533 seconds elapsed
USER_DEBUG [24]|DEBUG|Starting for Custom sorting: 0 seconds elapsed
USER_DEBUG [24]|DEBUG|Ending for Custom sorting: 15.767 seconds elapsed
```

That being said, who is actually sorting 10k Accounts at a given time? When I'm using custom sorting, it's typically on a couple hundred records at a given time. The performance cost may well be negligible for numbers like that — if the above example takes .283 seconds to sort 200 Accounts, you might not even notice the difference. Again, in FinTech, thousandths of a second matter. In most other arenas ... they don't. Plan accordingly.

## Conclusion On Sorting Performance In Apex

The TL;DR would probably look something like this:

- The assertion that sorting records in `Crud` is going to noticeable slow down your production instance's DML statements is demonstrably false
- The built-in SObject sorting method is crazy-performant in Apex
- Custom sorting can indeed slow down your application, so if latency matters, you may want to push operations that require custom sorting to asynchronous threads in order to maximize responsiveness

Thanks for reading the latest in the the [Joys Of Apex](). I hope you enjoyed — till next time!

The original version of [Sorting & Performance In Apex can be read on my blog.](https://www.jamessimone.net/blog/joys-of-apex/sorting-and-performance-in-apex/)

**Edit**:

The same reader pointed out that the list I was using in the original `Function` example was essentially pre-sorted, and that because SObject comparisons compare all fields supplied on the object (as well as its `SObjectType` label), I was potentially misrepresenting the results displayed by virtue of only having each account initialized based off of a Name field with the string value of the list's index. It seems that the reader's first issue — that sorting large lists could lead to catastrophic performance concerns — had been transformed into the argument that performing additional comparisons was going to be inordinately costly.

I've updated the article (and the subsequent figures) to reflect Accounts inserted into the list in a far more random fashion, with more fields filled out, to show that it doesn't significantly affect performance. Indeed, the numbers are virtually the same. No matter, though — I'm sure I'll have to fire up JMeter and livestream the new quadsort algorithm before this particular person is happy 🤣
