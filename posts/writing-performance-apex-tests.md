> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Writing Performant Apex Tests

> :Author src=github

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

Let's go back to basics when talking about designing and working in Apex codebases. There are a few design patterns that help to make your unit tests fast and performant -- which in turn speeds up your development time. As well, being able to run your whole test suite in a matter of minutes (max) becomes crucially important as your (or your client's) system grows organically over time. Refactoring code is a lot like weeding in a garden: you might see some beautiful things without it, but you'll never consistently be able to work in an Apex codebase without identifying patterns, abstracting them, and re-writing code to make use of the new abstractions.

There _is_ a time when it's too early to refactor -- while writing the code the first time. Indeed, the TDD mentality is often repurposed to promote something an old colleague of mine fondly refers to as "prefactoring" -- refactoring your code too early. The "red, green, refactor" mantra is encouraged instead of trying to achieve the perfect system upfront; code is inherently complicated, the business needs transform over time, and while humans are exceptional at pattern recognition when it's staring them in the face, we fare poorly as a species in attempting to forecast patterns. If you wouldn't do it with the stock market, in other words, you probably shouldn't be doing it with the code you're writing.

So what are the most important Apex patterns to follow? I would hazard to guess that the two most important patterns that should be followed in **all** Apex codebases are:

- the TriggerHandler pattern. This has been covered in great depth across a number of prominent SFDC bloggers over the years; a quick Google search for "apex trigger handler pattern" surfaces an enormous quantity of results. I just wrote a [lightweight TriggerHandler implementation](/lightweight-trigger-handler) so that if this is somehow the first time you're hearing about this pattern, you have a reference point
- Bulkification -- Salesforce coined the term "bulkify," advising developers to always consider the consequences of multiple SObjects being updated at a time. Given that users typically want bulk update capabilities on their List Views (to say nothing of what might happen from somebody kicking off a Flow ...), writing code that doesn't exceed your [Apex governor limits](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm) is of _crucial_ importance. Probably the most common thing that you see in this vein is the age-old adage about not performing SOQL queries in loops

So what follows, logically, when considering architecture on the SFDC platform in light of these two patterns? In a way, though Salesforce has now released the Platform Event and EventBus architecture, you can also think of your triggers as event observers. Most code is designed to do one of two things:

- respond to changes
- look for changes, then respond (Scheduled Apex, in other words)

## Test Fast, Test Often

What other patterns may be of use to the aspiring developer / systems architect? One of the reasons that [I advise the use of a DML-mocking architecture](/mocking-dml) is because of how expensive it is, in regards to time, to insert/update records in your unit tests. In a large org with hundreds/thousands of tests, it's not uncommon for test runs to take upwards of an hour (indeed, in some codebases, people might be _dreaming_ about the tests taking only an hour to run).

If you're in the middle of refactoring, minimizing the amount of time your tests take to run is the single best way to improve your development time. If you have to wait hours prior to validating a code change (or, even worse, a deploy fails and you have other features needing to be deployed at the same time ...), your ability to quicly respond to change has been completely hamstrung. It's also not necessary to do a total codebase overhaul when implementing changes like a DML-wrapper; start in an isolated area, show to your team/client's that development time speeds up when test coverage and speed lends itself to developer confidence, and make incremental changes to support an overall reduction in test time.

This leads me into coverage of the existing industry standard for mocking libraries, [FFLib's Apex Mocks](https://github.com/apex-enterprise-patterns/fflib-apex-mocks). It conforms to the Mockito dependency injection standard for mocking, and allows you to inject stubs into your Apex unit tests -- purportedly increasing their speed by replacing complicated database calls and large insert/update operations with mocks of your choice.

But how performant is the existing Apex Mocks library, when compared to the `Crud` class that I introduced in the aforementioned [Mocking DML](/mocking-dml) post, and made similarly accessible in your tests through the use of the [Factory Dependency Injection](/dependency-injection-factory-pattern) pattern? This originally came up as a pretty bold challenge by a user on reddit who seemed to suggest that there was no space in the Salesforce ecosystem for another dependency injection framework; I thought it best to test that assertion, and the results can also be found covered in great detail on my [Apex Mocks](https://github.com/jamessimone/apex-mocks-stress-test) repo's master branch.

The simplest possible method for stress-testing the two systems is to fake the insertion of a large amount of data. I originally wanted to iterate over a million rows to simulate what it would be like if you wanted to emulate potentially real-world conditions while working with Batch Apex or your org frequently responds to bulk interactions from external APIs:

```java
@isTest
private class ApexMocksTests {
    private static Integer LARGE_NUMBER = 1000000;

    @isTest
    static void fflib_should_mock_dml_statements_update() {
        // Given
        fflib_ApexMocks mocks = new fflib_ApexMocks();
        ICrud mockCrud = (ICrud)mocks.mock(Crud.class);
        Account fakeAccount = new Account();

        // When
        for(Integer i = 0; i < LARGE_NUMBER; i++) {
            mockCrud.doUpdate(fakeAccount);
        }

        // Then
        mocks.verify(mockCrud, LARGE_NUMBER);
    }

    @isTest
    static void crudmock_should_mock_dml_statements_update() {
        //Given
        ICrud mockCrud = CrudMock.getMock();
        Account fakeAccount = new Account();

        //When
        for(Integer i = 0; i < LARGE_NUMBER; i++) {
            mockCrud.doUpdate(fakeAccount);
        }

        //Then
        System.assertEquals(LARGE_NUMBER, CrudMock.Updated.size());
    }
}
```

That led to some pretty unfortunate results in the console.

Using diff notation to indicate test passes / failures:

```diff
$ yarn test ApexMocksTests*
$ dmc test ApexMocksTests*
[dmc] using org: apex-mocks (default)
[dmc] * src/classes/ApexMocksTests.cls
[dmc] ===> ApexMocksTests test results <===
+[dmc] [pass] ApexMocksTests: crudmock_should_mock_dml_statements_update, time: 4.635s
-[err] [fail] ApexMocksTests: fflib_should_mock_dml_statements_update =>
-System.LimitException: Apex CPU time limit exceeded =>
-Class.fflib_MethodCountRecorder.recordMethod: line 57, column 1
-Class.fflib_ApexMocks.recordMethod: line 170, column 1
-Class.fflib_ApexMocks.mockNonVoidMethod: line 280, column 1
-Class.fflib_ApexMocks.handleMethodCall: line 83, column 1
-Class.Crud__sfdc_ApexStub.doUpdate: line 103, column 1
-Class.ApexMocksTests.fflib_should_mock_dml_statements_update:
-line 14, column 1, time: 16.06s
[dmc] ===> Number of tests run: 2 <===
[dmc] ===> Total test time: 20.69500s <===
[err] Failed -> 1 test failures
[dmc] [NOT OK]
error Command failed with exit code 1.
```

Unlucky. The FFLib library can't handle iterating over a million rows (it also can't handle 100,000) - let's try 10,000 instead:

```java
//in ApexMocksTests.cls ...
private static Integer LARGE_NUMBER = 10000;
```

And the results:

```diff
$ yarn test ApexMocksTests*
yarn run v1.22.0
$ dmc test ApexMocksTests*
[dmc] using org: apex-mocks (default)
[dmc] * src/classes/ApexMocksTests.cls
[dmc] ===> ApexMocksTests test results <===
+[dmc] [pass] ApexMocksTests: crudmock_should_mock_dml_statements_update, time: 0.591s
+[dmc] [pass] ApexMocksTests: fflib_should_mock_dml_statements_update, time: 11.145s
[dmc] ===> Number of tests run: 2 <===
[dmc] ===> Total test time: 11.73600s <===
[dmc] [OK]
```

Dan Appleman talked several years ago at Dreamforce about the need for "burn-in" when testing: that test results can vary run-over-run, and that some optimization seemingly takes place within Apex as tests are run frequently. On the [Apex Mocks](https://github.com/jamessimone/apex-mocks-stress-test) repo, you can see the result of FFLib's library versus my own over no fewer than 10 different test runs, but the moral of the story is that these results didn't occur randomly, or vary wildly run over run. Time after time, the use of a simple DML wrapper proved to be ridiculously more performant than the existing FFLib mocking implementation. If you're working for an enterprise organization with hundreds or thousands of tests, the time-savings potential alone in using the Crud/CrudMock wrappers is something that should be making your ears perk up.

What other Apex paradigms can look to validate through the use of tests?

## Looping in Apex

> :Tabs
>
> > :Tab title= Iterating In Apex
> >
> > Let's talk about loops. You might be thinking to yourself right now ... _really, loops? Like, a for loop?? Why do we need to talk about that?!_ There's a _lot_ of potential in performance optimization when it comes to iterating through large lists of records -- particularly if this is an area you've never thought about optimizing, previously. Specifically, how you iterate through loops matters. If you're talking about business-critical functionality, the first thing you can optimize is the number of loops you execute.
>
> > :Tab title= Iteration Footnote
> >
> > This is not an Apex-specific optimization; a friend of mine and I were shocked, several years ago, when implementing analytics with [Mixpanel](https://www.mixpanel.com/) - their HTTP API for tracking events [accepts a maximum of 50 events at a time](https://developer.mixpanel.com/docs/http#section-batch-requests). Our first stab at splitting lists of events made heavy use of .Net's LINQ syntax -- a pleasant experience for any developer, particularly with a fluent interface that lets you chain together commands to quickly cobble together two different lists of event records. However, due to the number of times our lists were being iterated through with LINQ, our program's thread time was quite high ... and, as anybody familiar with cloud computing can relate to, time == \$\$. Ditching LINQ and using one iteration method to split up our lists ended up shaving enough time off of our process time to fit within the cheapest pricing level our cloud provider offered.

After that, though, there's a few different ways to iterate:

- the **absolute** classic WHILE loop. Your mom & dad wrote WHILE loops, and there's still nothing wrong with them today!
- the **boring** for loop with built in index: `for(Integer index = 0; index < SOME_NUMBER; index ++)`
- the syntax sugar version of the for loop: `for(SObject record : records)`
- the **dark horse**, the one that has so much potential but also comes built in ... the ITERATOR instance

Let's write some tests:

```java
@isTest
private class LoopTests {

    //I only added the baseline test after first running the initial
    //tests a number of times. You'll see when it starts to be measured
    //in my output. Apologies for the oversight!
    @isTest
    static void it_should_establish_baseline_using_while_loop() {
        List<SObject> accountsToInsert = fillAccountList();
    }

    @isTest
    static void it_should_test_fake_while_loop_insert() {
        List<SObject> accountsToInsert = fillAccountList();

        CrudMock.getMock().doInsert(accountsToInsert);

        System.assertEquals(LARGE_NUMBER, CrudMock.Inserted.size());
    }

    @isTest
    static void it_should_test_fake_basic_for_loop_insert() {
        List<SObject> accountsToInsert = new List<SObject>();
        for(Integer index = 0; index < LARGE_NUMBER; index++) {
            Account acc = new Account(Name = 'Test' + index);
            accountsToInsert.add(acc);
        }

        CrudMock.getMock().doInsert(accountsToInsert);

        System.assertEquals(LARGE_NUMBER, CrudMock.Inserted.size());
    }

    @isTest
    static void it_should_test_fake_syntax_sugar_for_loop_insert() {
        List<SObject> accountsToInsert = fillAccountList();

        for(SObject record : accountsToInsert) {
            setNameToRandomValue(record);
        }

        CrudMock.getMock().doInsert(accountsToInsert);

        System.assertEquals(LARGE_NUMBER, CrudMock.Inserted.size());
    }

    @isTest
    static void it_should_test_iterator_while_loop_insert() {
        List<SObject> accountsToInsert = fillAccountList();

        //you can only use iterators in while loops
        while(accountsToInsert.iterator().hasNext()) {
            setNameToRandomValue(accountsToInsert.iterator().next());
        }
    }

    private static Integer LARGE_NUMBER = 100000;
    private static List<SObject> fillAccountList() {
        Integer counter = 0;
        List<SObject> accountsToInsert = new List<SObject>();
        while(counter < LARGE_NUMBER) {
            Account acc = new Account(Name = 'Test' + counter);
            accountsToInsert.add(acc);
            counter++;
        }
        return accountsToInsert;
    }

    private static void setNameToRandomValue(SObject record) {
        record.put('Name', 'Something ' + Math.random().format());
    }
}
```

To be clear, because some of the test methods make use of the `fillAccountList` function and THEN do additional work, I was hoping to establish a baseline for how long that particular iteration took in order to understand how the other methods that required a filled list in order to do their own thing were affected. My first attempt with `LARGE_NUMBER` set to 1 million didn't go so hot:

```diff
$ yarn test LoopTest*
yarn run v1.22.0
$ dmc test LoopTest*
[dmc] using org: apex-mocks (default)
[dmc] * src/classes/LoopTests.cls
[dmc] ===> LoopTests test results <===
-[err] [fail] LoopTests: it_should_test_fake_basic_for_loop_insert =>
- System.LimitException: Apex CPU time limit exceeded =>
- Class.LoopTests.it_should_test_fake_basic_for_loop_insert: line 18, column 1, time: 16.05s
-[err] [fail] LoopTests: it_should_test_fake_syntax_sugar_for_loop_insert =>
-System.LimitException: Apex CPU time limit exceeded =>
-Class.LoopTests.fillAccountList: line 54, column 1
-Class.LoopTests.it_should_test_fake_syntax_sugar_for_loop_insert: line 28, column 1, time: 15.732s
-[err] [fail] LoopTests: it_should_test_fake_while_loop_insert =>
-System.LimitException: Apex CPU time limit exceeded =>
-Class.LoopTests.fillAccountList: line 52, column 1
-Class.LoopTests.it_should_test_fake_while_loop_insert: line 6, column 1, time: 16.082s
-[err] [fail] LoopTests: it_should_test_iterator_for_loop_insert =>
-System.LimitException: Apex CPU time limit exceeded =>
-Class.LoopTests.fillAccountList: line 53, column 1
-Class.LoopTests.it_should_test_iterator_for_loop_insert: line 41, column 1, time: 15.924s
[dmc] ===> Number of tests run: 4 <===
[dmc] ===> Total test time: 63.78800s <===
[err] Failed -> 4 test failures
[dmc] [NOT OK]
```

Hmm OK. Large number was a little too ... large. Let's try with 100k instead.

```diff
$ yarn test LoopTest*
yarn run v1.22.0
$ dmc test LoopTest*
[dmc] using org: apex-mocks (default)
[dmc] * src/classes/LoopTests.cls
[dmc] ===> LoopTests test results <===
+[dmc] [pass] LoopTests: it_should_test_fake_basic_for_loop_insert, time: 16.105s
-[err] [fail] LoopTests: it_should_test_fake_syntax_sugar_for_loop_insert
-=> System.LimitException: Apex CPU time limit exceeded =>
-Class.TestingUtils.generateIds: line 17, column 1
-Class.CrudMock.doInsert: line 21, column 1
-Class.LoopTests.it_should_test_fake_syntax_sugar_for_loop_insert: line 34, column 1, time: 15.869s
+[dmc] [pass] LoopTests: it_should_test_fake_while_loop_insert, time: 13.554s
-[err] [fail] LoopTests: it_should_test_iterator_for_loop_insert =>
-System.LimitException: Apex CPU time limit exceeded =>
-Class.LoopTests.setNameToRandomValue: line 61, column 1
-Class.LoopTests.it_should_test_iterator_for_loop_insert: line 44, column 1, time: 15.323s
[dmc] ===> Number of tests run: 4 <===
[dmc] ===> Total test time: 60.85100s <===
[err] Failed -> 2 test failures
[dmc] [NOT OK]
```

OK so we're getting somewhere. As expected, the while loop and vanilla for loop outperform their fancier counterparts. It's a little bit disappointing that the syntax sugar for loop and the iterator don't compile down to the same instructions, but let's change LARGE_NUMBER to 10k and get a look at the results (you'll notice this is also where I added in the baseline for the first time ...):

```diff
$ yarn test LoopTests*
yarn run v1.22.0
$ dmc test LoopTests*
[dmc] using org: apex-mocks (default)
[dmc] * src/classes/LoopTests.cls
[dmc] ===> LoopTests test results <===
+[dmc] [pass] LoopTests: it_should_establish_baseline_using_while_loop, time: 0.304s
+[dmc] [pass] LoopTests: it_should_test_fake_basic_for_loop_insert, time: 1.366s
+[dmc] [pass] LoopTests: it_should_test_fake_syntax_sugar_for_loop_insert, time: 2.354s
+[dmc] [pass] LoopTests: it_should_test_fake_while_loop_insert, time: 1.592s
-[err] [fail] LoopTests: it_should_test_iterator_for_loop_insert =>
-System.LimitException: Apex CPU time limit exceeded =>
-Class.-LoopTests.setNameToRandomValue: line 66, column 1
-Class.LoopTests.it_should_test_iterator_for_loop_insert: line 49, column 1, time: 16.473s
[dmc] ===> Number of tests run: 5 <===
[dmc] ===> Total test time: 22.08900s <===
[err] Failed -> 1 test failures
[dmc] [NOT OK]
```

Overall, this is some highly fascinating stuff. You can see that apples-to-apples, the basic while loop completely dominates, operating more than a second faster than the baseline for loop. As expected, the syntax sugar for loop lags a little bit behind. The real surprise, for me, though, was how terrible the performance of the built in List iterator is. Supposing that it is implemented behind the scenes as a simple while loop -- certainly, that's the implementation that I would expect in this case -- it seems downright bizarre for it to perform so poorly. I should also note that I run the tests several times before reporting the results, to ensure that any variations shake themselves out during burn-in.

I do believe there is a case to be made for custom iterators ... so let's test that vanilla implementation I was just discussing:

```java
public class ListIterator implements System.Iterator<SObject> {
    private final List<SObject> records;
    private Integer index;

    public ListIterator(List<SObject> records) {
        this.records = records;
        this.index = 0;
    }

    public boolean hasNext() {
        return this.index < this.records.size() - 1;
    }

    public SObject next() {
        if(index == records.size() -1) {
            return null;
        }
        index++;
        return records[index];
    }
}

//in LoopTests.cls
@isTest
static void it_should_test_custom_iterator_while_loop() {
    List<SObject> accountsToInsert = fillAccountList();
    Iterator<SObject> listIterator = new ListIterator(accountsToInsert);

    while(listIterator.hasNext()) {
        setNameToRandomValue(listIterator.next());
    }
}
```

And the results (let me just take a deep breath and let out the frustration following the use of the "Iterator" syntax. It's like Salesforce _wants_ to throw it back in our faces by saying: "look! Generics! Just not for you!!"):

```diff
$ yarn test LoopTests*
yarn run v1.22.0
$ dmc test LoopTests*
[dmc] using org: apex-mocks (default)
[dmc] * src/classes/LoopTests.cls
[dmc] ===> LoopTests test results <===
+[dmc] [pass] LoopTests: it_should_establish_baseline_using_while_loop, time: 0.391s
+[dmc] [pass] LoopTests: it_should_test_custom_iterator_while_loop, time: 1.32s
+[dmc] [pass] LoopTests: it_should_test_fake_basic_for_loop_insert, time: 2.189s
+[dmc] [pass] LoopTests: it_should_test_fake_syntax_sugar_for_loop_insert, time: 2.404s
+[dmc] [pass] LoopTests: it_should_test_fake_while_loop_insert, time: 1.65s
-[err] [fail] LoopTests: it_should_test_iterator_while_loop_insert =>
-System.LimitException: Apex CPU time limit exceeded =>
-Class.LoopTests.setNameToRandomValue: line 76, column 1
-Class.LoopTests.it_should_test_iterator_while_loop_insert: line 49, column 1, time: 16.205s
[dmc] ===> Number of tests run: 6 <===
[dmc] ===> Total test time: 24.15900s <===
[err] Failed -> 1 test failures
[dmc] [NOT OK]
```

That's much more in line with what I would expect. Which leads me to suspect that caching the iterator will help the basic implementation as well:

```java
//in LoopTests.cls
@isTest
static void it_should_test_iterator_while_loop_insert() {
    List<SObject> accountsToInsert = fillAccountList();
    Iterator<SObject> accountIterator = accountsToInsert.iterator();

    while(accountIterator.hasNext()) {
        setNameToRandomValue(accountIterator.next());
    }
}
```

```diff
$ yarn test LoopTests*
yarn run v1.22.0
$ dmc test LoopTests*
[dmc] using org: apex-mocks (default)
[dmc] * src/classes/LoopTests.cls
[dmc] ===> LoopTests test results <===
+[dmc] [pass] LoopTests: it_should_establish_baseline_using_while_loop, time: 0.388s
+[dmc] [pass] LoopTests: it_should_test_custom_iterator_while_loop, time: 1.303s
+[dmc] [pass] LoopTests: it_should_test_fake_basic_for_loop_insert, time: 1.773s
+[dmc] [pass] LoopTests: it_should_test_fake_syntax_sugar_for_loop_insert, time: 2.404s
+[dmc] [pass] LoopTests: it_should_test_fake_while_loop_insert, time: 1.633s
+[dmc] [pass] LoopTests: it_should_test_iterator_while_loop_insert, time: 0.791s
[dmc] ===> Number of tests run: 6 <===
[dmc] ===> Total test time: 8.29200s <===
[dmc] [OK]
```

Mystery solved! Considering that iterators are just decorating the basic while loop, it makes sense that they would closely follow it in terms of performance.

For mission-critical code that demands low latency, you should definitely consider using a while loop, or at the very least the built in iterator on the Salesforce List class.

## Exceptions in Apex

Let's talk about exceptions. When it comes to performance, building exceptions is an allegedly costly operation. Maybe this is coming as news to you (again, I would recommend a simple google search "java cost of throwing exceptions), but it kind of makes sense, thinking about all the extra stuff that needs to happen when an exception is thrown:

- first the nearest catch block has to be found
- if there's a catch block, the exception has to be tested against the catch block's constructor
- if the test passes, the exception is initialized and the catch block is entered
- if the test fails, the next catch block is searched for and the process is repeated
- unless there isn't another catch block, at which point the code terminates due to the uncaught exception
- PS, now you have to pay the time cost for the database rollback to occur. I hope the exception wasn't thrown 5 triggers deep!

Of course, particularly for dealing with HTTP related code, there's the temptation to write something clean ... something beautiful:

```java
@RestResource(urlMapping='/api/*')
global class HttpService {
    global class SalesforceResponse {
        global SalesforceResponse() {
            this.Success = true;
            this.IdsUpdated = new List<Id>();
        }

        public Boolean Success { get; set; }
        public List<Id> IdsUpdated { get; set;}
    }

    global class SalesforceRequest {
        List<Id> IdsToDoThingsWith { get; set; }
    }

    @HttpPost
    global static SalesforceResponse post(SalesforceRequest req) {
        SalesforceResponse res = new SalesforceResponse();
        try {
            //do something that will potentially fail here
            //with the Ids passed in
            if(someConditional != true) {
                throw new CalloutException('Meaningful fail message!');
            }
        } catch(Exception ex) {
            res.Success = false;
        }
        return res;
    }

}
```

Mmm. So clean. Single-return methods are so tasty. But are we leading ourselves astray with this pattern? Will it cost us valuable seconds to collect that Exception if our large data operation fails? As you know, there's only one way to find out ...

```java
@isTest
private class ExceptTesting {
    //salesforce has bizarre rules in place about
    //naming classes with the word Exception in them
    @isTest
    static void it_should_provide_baseline_testing_time() {}

    @isTest
    static void it_should_throw_exception() {
        throw new TestException();
    }

    @isTest
    static void it_should_catch_thrown_exception() {
        Exception ex;

        try {
            throw new TestException('Some message here');
        } catch(Exception exc) {
            ex = exc;
        }

        System.assertNotEquals(null, ex);
    }

    @isTest
    static void it_should_build_big_nested_stacktrace() {
        String exceptionMessage = 'hi'.repeat(100000);
        Exception caughtEx;
        try {
            try {
                throw new TestException('First exception');
            } catch(Exception ex) {
                throw new TestException(ex.getMessage() + '\n' + exceptionMessage);
            }
        } catch(Exception ex) {
            caughtEx = ex;
        }

        System.assertNotEquals(null, caughtEx);
    }

    private class TestException extends Exception {}
}
```

For one thing, I was interested in seeing if the uncaught exception would be faster in running than the caught one; for another, I wanted to see just how big a difference would be generated between the baseline for simply starting and running a test (which consistently hovers around 5-hundredths of a second):

```diff
$ yarn test ExceptTesting*
yarn run v1.22.0
$ dmc test ExceptTesting*
[dmc] using org: apex-mocks (default)
[dmc] * src/classes/ExceptTesting.cls
[dmc] ===> ExceptTesting test results <===
+[dmc] [pass] ExceptTesting: it_should_build_big_nested_stacktrace, time: 0.031s
+[dmc] [pass] ExceptTesting: it_should_catch_thrown_exception, time: 0.005s
+[dmc] [pass] ExceptTesting: it_should_provide_baseline_testing_time, time: 0.006s
-[err] [fail] ExceptTesting: it_should_throw_exception =>
-ExceptTesting.TestException: Script-thrown exception =>
-Class.ExceptTesting.it_should_throw_exception: line 10, column 1, time: 0.005s
[dmc] ===> Number of tests run: 4 <===
[dmc] ===> Total test time: 0.04700s <===
[err] Failed -> 1 test failures
[dmc] [NOT OK]
```

Admittedly, perhaps my methodology is simply busted, but even though the "cost" of building an extremely convoluted exception out of several other exceptions is 6 times slower than simply not catching, the _real_ cost of building safe structures and code paths in your application may win out. It all depends on how much latency matters to you. In FinTech, hundredths of a second matter; they're the difference between making money and losing it.

Being aware of the potential time tax you might be paying due to your application's code helps you avoid paying the tax when performance matters.

## Back To Refactoring

Let's go back to our original mocking DML example:

```java
@isTest
private class LoopTests {
    @isTest
    static void it_should_establish_baseline_using_while_loop() {
        List<SObject> accountsToInsert = fillAccountList();
    }

    @isTest
    static void it_should_test_fake_while_loop_insert() {
        List<SObject> accountsToInsert = fillAccountList();

        CrudMock.getMock().doInsert(accountsToInsert);

        System.assertEquals(LARGE_NUMBER, CrudMock.Inserted.size());
    }

    @isTest
    static void it_should_test_actual_while_loop_insert() {
        List<SObject> accountsToInsert = fillAccountList();

        //I would typically use the singleton Crud.doInsert method here
        //but ultimately they're the same operation
        insert accountsToInsert;

        List<Account> insertedAccs = [SELECT Id FROM Account];
        System.assertEquals(LARGE_NUMBER, insertedAccs.size());
    }

    private static Integer LARGE_NUMBER = 10000;
    private static List<SObject> fillAccountList() {
        Integer counter = 0;
        List<SObject> accountsToInsert = new List<SObject>();
        while(counter < LARGE_NUMBER) {
            Account acc = new Account(Name = 'Test' + counter);
            accountsToInsert.add(acc);
            counter++;
        }
        return accountsToInsert;
    }

    private static void setNameToRandomValue(SObject record) {
        record.put('Name', 'Something ' + Math.random().format());
    }
}
```

With large number set to 10,000, let's see what happens when comparing the actual cost of inserting records compared to faking their insert through the CrudMock:

```diff
$ yarn test LoopTests*
yarn run v1.22.0
$ dmc test LoopTests*
[dmc] using org: apex-mocks (default)
[dmc] * src/classes/LoopTests.cls
[dmc] ===> LoopTests test results <===
+[dmc] [pass] LoopTests: it_should_establish_baseline_using_while_loop, time: 0.4s
+[dmc] [pass] LoopTests: it_should_test_actual_while_loop_insert, time: 54.043s
+[dmc] [pass] LoopTests: it_should_test_fake_while_loop_insert, time: 1.541s
[dmc] ===> Number of tests run: 3 <===
[dmc] ===> Total test time: 55.98400s <===
[dmc] [OK]
```

............ welp. OK then. As you can see, there's a considerable amount of variation in what Salesforce allows when it comes to testing time. I ran this (and the other tests in LoopTests) several times to validate these results. Performing actual DML is absurdly expensive in terms of time.

What are some other operations that can lead to testing slowdown?

- Going from Contracts into new Opportunities with CPQ
- converting Leads
- merging of any kind (Lead to Lead, Lead to Contact/Account -- which is actually conversion, Contact to Contact, Account to Account)
- calculating rollup fields on Master-Detail records (this one is also extremely prone to the dreaded `unable to lock row` error in tests, unless you are very careful to use randomized names between records)
- upserting on external Ids (upserting in general, since it falls into the realm of DML)

In [Clean Code](https://smile.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882/), there's an excellent chapter on boundaries in code; how to recognize them, how to plan around them. Knowing that these are the weak spots when it comes to writing performant code (not only in your unit tests, but in your application code) can help you to identify the spots that are the most important to isolate in your code.

As an example, if you have tests for performing merges, you might consider mocking your merging code in places where merging is a side-effect of the code you have under test. Likewise, you should definitely try to minimize where leads are being converted in your test code.

These tips should be part of your everyday testing toolbelt -- and should occupy the same space in your mind as the sacred rules like:

- always use randomized values when setting unique fields on test objects so that your tests can run safely in parallel
- always use @testSetup methods when you need to insert objects that will be required by more than one of your test methods

## Conclusion

It's my hope that this article helps you to think about the importance of your own time, and the time of your team, when it comes to writing tests. One of the reasons that I'm a firm proponent of TDD (and paired programming!) is that it allows you (and your team, if you have one) to observe the positive effects of a test-first mentality: when you can run your tests often, and they run quickly, you feel empowered to move quickly in your codebase(s). You also get to see patterns develop organically over time; instead of trying to force yourself to be the perfect architect at all times, you can get straight into the weeds prior to taking out your refactoring tools.

This last point is particularly prescient for the perfectionists. I've seen many talented developers waylay themselves, lost in thought over the perfect class setup and the DRY-est methods. Simply getting down to business gets your creative juices flowing, allows you to recognize patterns as they occur, and clean the code up as you go. Over time, of course, you build the muscle-memory necessary to identify paradigms before code is written; once you've built one publicly facing API, for example, you know what goes into scaffolding the structure and can remember the gotchas when it comes time to build the next one.

If you're looking to dig into the code a little bit more than what was exhibited here, I would encourage you to check out the [performant-tests branch on my Apex Mocks repo](https://github.com/jamessimone/apex-mocks-stress-test/tree/performant-tests). Thanks for taking this testing ride with me -- till next time!
