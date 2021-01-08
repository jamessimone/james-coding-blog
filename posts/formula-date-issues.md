> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Formula Date Issues

> :Author src=github,date=2020-10-26T15:12:03.284Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

Calculating time differences correctly is challenging. With more than two dozen time zones at play on any given day around the world, and yearly / historical fluctuation in time, it's no wonder that Salesforce stores dates in GMT and tries to enforce good practices surrounding time and date calculation by giving you -- the developer -- quality date/time APIs when dealing with them.

Apex, via the `Date` and `Datetime` classes, does a pretty good job of helping us to work with dates. As a counter-example, take JavaScript. For years, frontend frameworks were weighed down by the usage of `Moment.js`, the library that attempted to restore some Date/time sanity to JS. Weighing in at a whopping 329 KB, Moment is still used on thousands of sites to aid in JS's poor standard library date calculation and formatting attempts. Indeed, for something as simple as formatting the current date to the United States' MM/dd/YYYY date format, look at the vanilla JavaScript solution:

```js
// returns a MM/dd/YYYY string
// based on today's date
const getTodayString = () => {
  const today = new Date();
  // getMonth decided it was a special flower
  // and got to be 0-based, even though that
  // makes absolutely no sense in the context
  // of months. Imagine if JS also chose to be
  // 0-based for getDate()!
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const year = today.getFullYear();

  return (
    (month < 10 ? "0" + month : month) +
    "/" +
    (day < 10 ? "0" + day : day) +
    "/" +
    year
  );
};
```

When presented with the issue of how to best generalize this function to support different formatting strings and country conventions, you can quickly come to appreciate the [Simple Date Format](https://docs.oracle.com/javase/7/docs/api/java/text/SimpleDateFormat.html) used in both Apex and Java.

For those of us in the US, there's an election coming up (vote!) -- wanting to do something specific on a particular date is one of the most common pieces of business logic we end up encapsulating through programming. Whether it's serving up a notification to users in the form of a Salesforce Task, or writing some business-centric term to another field that ends up getting surfaced in daily/aggregated reports, being able to successfully match records based on date-bound criteria is incredibly important. On the subject of the election, imagine if you are trying to serve up reminders to employees spread across the US to vote prior to beginning work on Election Day. Now imagine what would happen if that notification was calculated based on Eastern Standard Time (EST). Your employees working in Pacific Standard Time (PST), three hours behind EST, don't get served the notification till they're well into their workday. Not ideal, not ideal.

When crafting experiences like Next best offer/action into staff workflows, we quickly come to understand the importance not only of the Date component, but also of how time adds complexities to many simple requirements. Serving somebody a personalized email / call frequently works better during a person's lunch break/off-hours versus trying to contact them or advertise to them during their business day.

## Formula Field Date Issues

When making decisions based off of `Date` fields in Apex, you might be tempted to think that you've avoided all of the timezone complexity associated with `Date`'s more complicated form, `Datetime`. For the most part, you would be correct. Where things get more complicated is when Apex and formula fields come into play:

```java
@isTest
private class DateTests {
  @isTest
  static void a_formula_retrieved_from_the_db_behaves_the_same_as_a_new_date() {
    Task t = new Task(
      ActivityDate = Date.newInstance(2019, 09, 30),
      Subject = 'Leap year test'
    );
    insert t;

    //DateTest__c formula: ADDMONTHS(ActivityDate, 15) + 1
    t = [SELECT ActivityDate, DateTest__c FROM Task];
    System.assertEquals(
      t.ActivityDate.addMonths(15).addDays(1),
      Date.newInstance(2020, 12, 31)
    );
    System.assertEquals(
      Date.newInstance(2020, 12, 31),
      t.DateTest__c,
      'oh no! Why, Apex, why?!'
    );
  }
}
```

You got it, this test fails at the second assertion -- the `DateTest__c` formula evaluates to 1 Jan 2021! Interestingly (? I thought it was interesting at least), there is no `ADDDAYS` or `ADDYEARS` formula function -- just `ADDMONTHS`. Even when creating a new `Date` formula field, though, the example that is displayed within the UI would have you believe that adding and subtracting days is easy: `Reminder Date = CloseDate - 7`. All the examples in the Developer documentation would have you believe that date math is a trivial subject.

So is the discrepancy between the formula field and what gets calculated via Apex merely the result of 2020 being a leap year? Let's find out:

```java
// this test passes
Task t = new Task(
  ActivityDate = Date.newInstance(2019, 01, 31),
  Subject = 'Feb month test'
);
insert t;

//DateTest__c formula: ADDMONTHS(ActivityDate, 1) + 1
t = [SELECT ActivityDate, DateTest__c FROM Task];
System.assertEquals(
  t.ActivityDate.addMonths(1).addDays(1),
  Date.newInstance(2019, 03, 01)
);
System.assertEquals(
  Date.newInstance(2019, 03, 01),
  t.DateTest__c
);
```

If we remove the `+1` from the `DateTest__c` formula and change the assertions to expect the date being February 28th, the test again passes. This is great! Exactly what we wanted. But glancing at the definition for `ADDMONTHS`, it's also trivially easy to "break" -- or at least challenge -- this example:

> Returns the date that is the indicated number of months before or after a specified date. If the resulting month has fewer days than the start month, then the function returns the last day of the resulting month. Otherwise, the result has the same day component as the specified date.

Merely by changing the initial value of `ActivityDate` to 30 January, we can break the above test. And, after all, the question is now largely subjective -- what _should_ the value become when adding a month where the resulting month has fewer days than the accumulator? In the statement:

```java
// using t.ActivityDate = Date.newInstance(2019, 01, 30)
System.assertEquals(
  t.ActivityDate.addMonths(1),
  Date.newInstance(2019, 02, 27)
);
```

Does it make sense that the test now fails because `t.ActivityDate.addMonths(1)` evaluates to `2019-02-28`? I honestly couldn't say. I could certainly make the argument that the second-to-last day in one month should always equal the second-to-last day in another month, regardless of how many days those months have ... but that doesn't _fix_ our problem. And the truth is that as long as you're using `ADDMONTHS`, the formula function, in conjunction with `addMonths` in Apex, you're likely to occasionally run into mismatches; short of advising against the use of one or the other definitively, there's no easy action item as far as addressing this problem (unless Salesforce decides to fix the root issue). In a world where two identical-seeming functions can produce different results, information is power -- knowing that this _can_ happen gives you helpful insight when it _does_ happen. You can also start to appreciate why new parents frequently refer to their children's age(s) in _weeks_ instead of months. 👼 😁

## Paying Credit Where Credit Is Due

This is an informational post, and [Jim Bartek of Growth Heroes](https://growthheroes.com/who-we-are/) is responsible for creating the [astoundingly-detailed repository](https://github.com/GrowthHeroes/apex-formula-tests) showcasing many of the formula field / Apex idiosyncracies that could wind up biting you. Jim didn't ask me to write this -- I thought it might be a helpful PSA for the community -- but I wanted to thank him for working hard to show everyone the potential pitfalls of calculating dates using formulas, especially where those dates will be used as comparisons within Apex (though Jim has also included a failing validation rule example which may pique your interest). Because not everyone is browsing Github looking for repos that describe a problem-state they're experiencing, featuring his work here on [The Joys Of Apex](/) is meant to expand the number of people reached.

If you haven't already become a member on the [SFXD Discord](https://join.sfxd.org/), you can find helpful souls like Jim around, both on the `#dev` and `#isv`-flavored channels. It's people like him that make this the single finest support community for questions related to Salesforce, and while I had previously experienced vagueries associated with Dates in Apex, it was only after seeing Jim's Github writeup that I decided to make a foray into actually reproducing the issues in a digestible way.

## Other Fun Date Issues

Speaking of fun `Date` class issues in Apex, this is the `git diff` from one of my favorite commits from this year:

```diff
- order.FillDate = System.today().addDays(100);
+ order.FillDate = System.today().addDays(125);
```

The commit message? `Fixing UTC date issue that fails unit test for order status on deploys after 7pm EST`. Turns out if you're deploying after UTC midnight (depending on your Salesforce org's time zone) _and_ you have logic that, say, assigns different statuses based on a specific date range (in this case, an object being within 100 days of today's date, or not), _you're gonna have issues_. This is something to be mindful of particularly when trying to decouple object setup from testing; while it's good practice to have commonly used `SObjects` -- and DTO objects like the one shown above -- be initialized from a test data factory. This allows you to standardize required fields with sensible defaults. It's also important, though, to be explicit in your tests! -- if your test(s) requires a date to be outside of a certain range and brooks no exceptions to that rule, explicitly setting your date to something outside of that range within the test(s) helps raise visibility of that expectation, and it aids in debugging if (when?) you run into issues like this one. If you have multiple test methods that require this value, it's fine to use a helper method in a test to set the defaults specific to that test class. Food for thought!

Worth noting, as well, is that this "issue" can strike with both `Date` and `Datetime` fields.

## Formula / Date Issues Wrap Up

Programming safely around dates and time isn't always challenging -- but the idiosyncracies of the SFDC platform have to be respected. Moving date issues from an _unknown unknown_ to a _known known_ means you're prepared to explain seemingly arbitrary occurrences in an informed light. Thanks again for reading the [Joys Of Apex](/)!

It's been 10 months (or, in light of this post: nearly a year, or 43 weeks and 3 days ...) since I first began writing this series, and I'd invite you to look back at the [intro](/intro) to remind you how it all began. For more fun with the `Date` class, be sure to checkout my writeup on the [Custom Rollup solution looking to replace DLRS](/replacing-dlrs-with-custom-rollup)!

The original version of [Formula Date Issues can be read on my blog.](https://www.jamessimone.net/blog/joys-of-apex/formula-date-issues/)
