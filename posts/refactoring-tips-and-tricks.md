> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Refactoring Tips & Tricks

> :Author src=github, date=2020-07-30T15:12:03.284Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

Identifying areas for potential code reuse is not always obvious. People learn and remember things in different ways; on a large team, and in a large project, keeping the entirety of a code base in your head is frequently an improbable proposition. Some manage. Some find themselves rewriting functions monotonously, either on a tight sprint deadline or simply because it’s easier to _copy paste_ than it is to generalize. Refactoring is, ultimately, a luxury — but one that is worthwhile to invest your time in, as you will reap the dividends of refactoring efforts the longer your code is in use.

I’d like to walk you through some of my favorite refactoring tools — both mental and tangible assets that may help you to identify repetitive code that it is safe to abstract upon or consolidate.

## Collection Utilities

I have frequently touched upon the necessity of Apex `List` (and other iterable classes) helpers. In another programming language, you frequently have the option to extend the base library classes in order to add functionality as you see fit — since we don’t have that luxury in Apex, it instead makes sense to cover useful `List` extension methods, which can reside in a helper class. Once more, we’re left without the tools we might otherwise be armed by: since you can’t create static classes in Apex, I typically like to label my Utils classes as abstract. This prevents them from being erroneously instantiated at runtime.

The "two" biggest helper functions you will 100% find use for in your journey through Apex? Methods for creating Maps from Lists or Sets. I say "two" in quotes because you will also benefit from overloading these methods to give you greater flexibility (although you only need to adopt the methods you intend to use). Before showing them off, let's look at a little code that you might find familiar:

```java
//a processing method in one of your classes
private Map<Id, List<SObject>> getTasksKeyedToAccounts(List<Account> accounts) {
    //you might prefer a lower allocation cost
    //method to get the Ids for each account.
    //that's legit! I also typically keep this
    //method in the same utils class I'll be showing
    Set<Id> accountIds = new Map<Id, Account>(accounts).keySet();
    List<Task> tasks = [
        SELECT Id, WhatId, etc ...
        FROM Task
        WHERE WhatId =: accountIds
    ];

    Map<Id, List<SObject>> accountIdToTasks = new Map<Id, List<SObject>>();
    for(Task t : tasks) {
        if(accountIdToTasks.containsKey(t.WhatId)) {
            accountIdToTasks.get(t.WhatId).add(t);
        } else {
            accountIdToTasks.put(t.WhatId, new List<SObject> { t });
        }
    }

    //do further processing higher in the call stack
    return accountIdToTasks;
}
```

That's your garden-variety one-to-many example of code that is practically begging to be refactored. There is also the (much simpler) one-to-one example: the cases where you need to return a `Map<Id, SObject>`. In both instances, it's entirely possible that you will occasionally also have some additional filtering criteria when building your Map — it may be the case that at times you need to filter some of your SObjects out based on domain-specific business rules. Taking the previously shown example a bit further (and for more notes on making constants for your picklists, check out [my post on Picklist Validation](/picklist-validation)):

```java
//back in getTasksKeyedToAccounts
//normally I would use previously constructed constants
//if these values, like the below, were coming from a picklist
List<String> matchingTaskTypes = new List<String>{ 'Chat', 'Inbound' };
for(Task t : tasks) {
    //if the task's type doesn't match some pre-approved list
    //don't add it
    if(matchingTaskTypes.contains(t.Type)) {
        continue;
    }
    else if(accountIdToTasks.containsKey(t.WhatId)) {
        accountIdToTasks.get(t.WhatId).add(t);
    } else {
        accountIdToTasks.put(t.WhatId, new List<SObject>{ t });
    }
}
```

So ... let's review our use-cases:

- building `Map<Id, SObject>` with and without filtering
- building `Map<Id, List<SObject>>` with and without filtering

Let's take a look at the tests, first:

```java
@isTest
private class CollectionUtilsTests {
    @isTest
    static void it_should_create_one_to_one_map_from_key() {
//this is an extremely dumbed down example
//you could accomplish the same thing with
//the standard Map constructor, but this method
//serves to show that an Id and a String can be used
//interchangeably in this context, and that the SObjectField
//token can be used to create the Map keys
        List<Account> accounts = new List<Account>{
//I've shown the TestingUtils method enough times that I think
//we can skip the documentation on it. Google it or check
//my repo for the source code
            new Account(Id = TestingUtils.generateId(Account.SObjectType))
        };

        Map<String, SObject> expected = new Map<String, SObject> {
            accounts[0].Id => accounts[0]
        };

        System.assertEquals(expected, CollectionUtils.convertToMap(accounts, Account.Id));
    }

    @isTest
    static void it_should_create_one_to_many_map_from_key() {
        Id accountId = TestingUtils.generateId(Account.SObjectType);

        List<Task> expected = new List<Task>{
            new Task(WhatId = accountId, Id = TestingUtils.generateId(Task.SObjectType)),
            new Task(WhatId = accountId, Id = TestingUtils.generateId(Task.SObjectType))
        };

        Map<String, List<SObject>> actual = CollectionUtils.convertToListMap(expected, Task.WhatId);
        System.assertEquals(expected, actual.values()[0]);
//yes, you can compare Ids and Strings directly without a cast
        System.assertEquals(true, actual.containsKey(accountId));
//here you need a cast of some sort since next() returns Object
//clearly (String) would also suffice
        System.assertEquals(accountId, (Id)actual.keySet().iterator().next());
    }
}
```

This is the basic setup, using static `convertToMap` and `convertToListMap` methods, which I will show in a moment. Some things to note:

- Ids can function as Strings. This is not a well-documented SFDC feature, but it's something that allows you incredible flexibility when constructing genericized Maps of SObjects
- even if you could have returned a strongly typed SObject (a Task or Account in these examples), you _will_ now have to cast when dealing with your SObjects on the calling side. I consider this a small price to pay for not having to write out those iterations every time I need to key something by an Id/String.
- this structure could be further generalized (instead of locking the inner Map's type down to just `SObject`s); the paradigm functions well with the base `Object` as well, which allows you to use these functions anywhere within the system instead of just on Salesforce objects.

The more complex setup for each method that allows you to perform filtering operations (tests first!):

```java
//in CollectionUtilsTests
public class TestCollectionEvaluator extends CollectionUtils.CollectionEvaluator {
    private final List<String> taskTypes;

    public TestCollectionEvaluator() {
        super();
        this.taskTypes = new List<String> {
            'Chat',
            'Inbound Call'
        };
    }

    public override Boolean matchesCriteria(SObject obj) {
//or you could do a "get" here
        return this.taskTypes.contains(((Task)obj).Type);
    }
}

@isTest
static void it_should_create_one_to_many_map_with_filter() {
    Id accountId = TestingUtils.generateId(Account.SObjectType);

    List<Task> tasks = new List<Task>{
        new Task(WhatId = accountId, Id = TestingUtils.generateId(Task.SObjectType)),
        new Task(WhatId = accountId, Id = TestingUtils.generateId(Task.SObjectType)),
        new Task(
            WhatId = accountId,
            Id = TestingUtils.generateId(Task.SObjectType),
            Type = 'Chat' //again this would normally be a const
        )
    };

    Map<String, List<SObject>> actual = CollectionUtils.convertToListMap(
        tasks,
        Task.WhatId,
        new TestCollectionEvaluator()
    );

    System.assertEquals(tasks[2], actual.values()[0][0]);
}

//etc, you get it - the next test is the one-to-one with filter
```

Now we've taken the original functionality and generalized it, adding an abstract class that only needs its children to implement a `matchesCriteria` boolean method to perform complex filtering. Let's take a look at the source code:

```java
//since it can't be static
public abstract class CollectionUtils {
    public static Map<String, SObject> convertToMap(List<SObject> sObjectList, String field) {
        return converttoMap(sobjectList, field, null);
    }

    public static Map<String, SObject> convertToMap(List<SObject> sObjectList, SObjectField field) {
        return convertToMap(sObjectList, field.getDescribe().getName(), null);
    }

    public static Map<String, SObject> convertToMap(List<SObject> sobjectList,
        SObjectField field, CollectionEvaluator eval) {
        return convertToMap(sobjectList, field.getDescribe().getName(), eval);
    }

    public static Map<String, SObject> convertToMap(List<SObject> sObjectList,
        String fieldName, CollectionEvaluator eval) {
        Map<String, SObject> mapping = new Map<String, SObject>();
        for(SObject sObj : sObjectList) {
            String key = (String)sObj.get(fieldName);
            if(String.isBlank(key) ||
                eval != null && eval.matchesCriteria(sObj) == false) {
                continue;
            }
            mapping.put(key, sObj);
        }
        return mapping;
    }

    public static Map<String, List<SObject>> convertToListMap(List<SObject> sObjectList, SObjectField idKey) {
        return convertToListMap(sObjectList, idKey.getDescribe().getName(), null);
    }

    public static Map<String, List<SObject>> convertToListMap(List<SObject> sObjectList, String idKey) {
        return convertToListMap(sObjectList, idKey, null);
    }

    public static Map<String, List<SObject>> convertToListMap(List<SObject> sObjectList, SObjectField idKey,
        CollectionEvaluator eval) {
        return convertToListMap(sObjectList, idKey.getDescribe().getName(), eval);
    }

    public static Map<String, List<SObject>> convertToListMap(List<SObject> sObjectList, String idKey,
        CollectionEvaluator eval) {
        Map<String, List<SObject>> keyToListValues = new Map<String, List<SObject>>();
        for(SObject sObj : sObjectList) {
            String key = (String)sObj.get(idKey);
            if(String.isBlank(key) ||
                eval != null && eval.matchesCriteria(sObj) == false) {
                    continue;
            }
            else if(keyToListValues.containsKey(key)) {
                keyToListValues.get(key).add(sObj);
            } else {
                keyToListValues.put(key, new List<SObject>{ sObj });
            }
        }
        return keyToListValues;
    }

    public abstract class CollectionEvaluator {
        public abstract Boolean matchesCriteria(SObject obj);
    }
}
```

That may look like a lot of boilerplate, but these methods are insanely useful. I count 10+ examples of the `convertToListMap` method being called in a random org, and 20+ calls to `convertToMap`. The base methods are 11 and 13 lines long, respectively; the full palette of them amounts to 56 lines of code. If you make use of these methods more than 5 times in your entire codebase, they're worth implementing, and your savings compounds as you make more and more use of them. In the org I just quoted, that's a savings of ~300 lines of code! Plus you can cut down lines if you intend to only use these with `SObjects` without complex fields; in that case, you only need the method definitions with the `SObjectField` tokens.

Measuring the performance of dev teams is more an art than a science, and developers have long pushed back on being measured by lines of code produced; in general, whenever LOC is the actual metric by which people are measured, copying and pasting is the preferred past-time. If the metric were which developers were _removing_ the most code, things would be a lot more interesting: I'm not making the case that you should be using this as a performance metric, but removing code through generalizing key usage patterns saves you time and energy in the long run.

Since working with collections is such a frequent paradigm within Apex, think hard and observe often when interacting with and writing new code related to lists/sets/maps. Refactoring to an invocation you can consume in more places may take you a little bit up front, but will save you more and more as time goes on. I'm not trying to touch on an exhaustive list of `CollectionUtils` methods; rather, my point in this post (and in posts like [Lazy Iterators](/lazy-iterators) is that because we work with collections so frequently, they are a ripe area of the codebase to achieve easy refactoring wins).

## Identifying Other Areas For Code Reuse

What are some other big areas where you can find refactoring potential in your Salesforce org? I've spoken about centralizing your SOQL methodology in the [Repository Pattern](/repository-pattern); this doesn't just give you type-safety for all your Apex queries, it also allows you to test against your SOQL where clauses (in and of itself a good thing).

Code that focuses on callouts is also a good place to revisit. It can be verbose to always be instantiating `HttpRequestMessage` objects — there's an opportunity to consolidate things accordingly.

Those examples are the most generalized, but in each individual org there also exists different paradigms, complexities, and conformity to standards (both those that are widely available and self-imposed ones). With such creativity abounding, how can we best analyze our code in a time-efficient manner in order to identify low-hanging fruit?

### Cleaning Up Aura Components

One person I'd like to give a shoutout to is [Justin Lyon](https://github.com/jlyon87), who is constantly active and helpful on the SFXD discord — on the subject of Aura components, he was the first I've seen to suggest generalizing your Aura actions to avoid a ton of the `setCallback/getCallback` boilerplate that comes with Apex/LDS interactions in Aura. [He uses a static resource](https://github.com/jlyon87/lightning-kit/blob/master/js/promisify.js) to ensure `promisify` can be imported via `ltng-require` tag (a problem obviated in LWC by the ability to create actual utils; for more info see the Readme in the linked Github for Justin's project):

```javascript
window.kit = (function Promisify(kit) {
  var promisify = function (auraAction) {
    return new Promise(
      $A.getCallback(function (resolve, reject) {
        auraAction.setCallback(this, function (res) {
          var state = res.getState();
          if (state === "SUCCESS") {
            resolve(res);
          } else {
            reject(res);
          }
        });

        $A.enqueueAction(auraAction);
      })
    );
  };

  kit.promisify = promisify;

  return kit;
})(window.kit || {});
```

Justin has a bunch of other utils that can get added to the global `kit` object, and they're all worth browsing through! He also had some helpful things to say on the potential downsides to using `ltng-require`, since scripts loaded via that means don't execute if the Aura component in question isn't rendered — [Salesforce's `backgroundUtilityItem` component](https://developer.salesforce.com/docs/component-library/bundle/lightning:backgroundUtilityItem/documentation) can be used as a cleaner means of accomplishing adding helper functions to Aura, and Justin [has an example repo for that as well](https://github.com/jlyon87/aura-toaster).

---

Me not having thought about the Aura action boilerplate just goes to show that switching context can sometimes lead to wearing the wrong hat; when I first started writing Aura components, (as I've talked about previously in [my post on building a custom Lead Path LWC](/lwc-custom-path)), I barely knew the difference between Aura and JavaScript — and by the time I did, the glaring code duplications in each of my components wasn't something I'd thought about. Think about the different contexts you switch into when writing code — is there an area for improvement beyond Apex?

### Enter Sloppy

The (most excellently) named [Sloppy](http://strlen.com/sloppy/) is _by far_ my favorite static code analysis tool — and because it's language agnostic, this means that you can use it to scan your entire codebase by filetype.

Sloppy works by tokenizing your code by block and analyzing tokens that are similar. This allows it to detect matching lines and lines that nearly match across files, and "rank" that code in terms of Sloppiness (where a higher score means more duplication) across your entire codebase. It's an extremely powerful tool — let's see it in action. (**Note**: sloppy only takes a few seconds to run, but if you want instant feedback on what's happening, I recommend running it on powershell if you're developing on Windows. In bash the output doesn't stream till the operation completes):

```powershell
# in the directory you've downloaded sloppy to
./sloppy -ccls -o50 the/directory/your/code/resides
```

So let's see what's going on here — sloppy takes a few command line arguments to make your life easier. It automatically scans for a ton of commonly used file extensions by default:

- JavaScript
- C/C++/C#
- Java
- PHP
- Python
- etc ...

The first argument, `-ccls` adds `.cls` to the list of file endings. The second arg, `-o50` expands the printed list of most sloppy tokens to 50. You can tailor the number of results to suit your fancy; it defaults to 10. A _third_ argument you might consider using would be `-eTest` (sloppy is case-sensitive with args); you may find that a lot of your duplication comes from test files, and might be OK with omitting that from the results to focus on the _real_ issues. In tests, there is also something to be said for the occasional duplication, if it makes an individual unit test easier to read.

Many of the results are keyed to the specific business and are, ultimately, not interesting; I've run sloppy on this particular codebase many times, and I've winnowed down the particularly glaring repetitions already. An example of sloppy's output that _is_ interesting would be the below snippet:

```powershell
34 tokens & 3 skips (743 sloppiness, 0.32% of total) starting at:
=> C:\Users\myName\Documents\Code\someOrg\src\classes\Class1.cls:145
=> C:\Users\myName\Documents\Code\someOrg\src\classes\Class2.cls:100
```

```java
if (accountIdToContact.containsKey(acc.Id)) {
    Contact con = accountIdToContact.get(acc.Id);
    con.OwnerId = acc.OwnerId;
    this .... //end token
```

Pretty benign repetition, but if there were many classes using that same owner assignment paradigm (and sloppy will print out _all_ classes where the duplication occurs), I would definitely consider consolidating that logic. Interestingly, the biggest offender in this codebase is actually the Aura components with their repetitive action handling! Fool me once ...

Sloppy also outputs some cool stats regarding the overall "sloppiness" of your project in terms of duplication:

```powershell
summary:

total tokens: 96206
total sloppiness: 234333
sloppiness / token ratio: 2.44
```

That last part — the "sloppiness / token ratio" means you should be looking for a lower score. The first time I ran sloppy on this codebase, the score was hovering around 12, if I recall correctly. I definitely put a lot of time into lowering that ratio!

## Closing Thoughts On Refactoring

In the end, how you choose to refactor is your own perogative. That being said, I hope that for dealing with collections in Apex, as well as identifying other key repetitive areas in your codebase, this post will prove of service. At the very least, thinking about how your code may be bloated is always helpful in refining your craft.

As well, there are many static code analysis programs available. I happen to like sloppy because it's small, fast as hell, and it can be run on many different codebases. The gamified output also provides satisfying feedback as you refactor the code it identifies as being duplicated. Of course, I'll be curious to hear about the different tools other people use (I know some people swear by Apex PMD, but the analysis that Apex PMD provides is more in the sense of guidelines: don't perform SOQL in loops; don't create deeply nested `if` statements, etc ...) — share the knowledge 😀. Till next time!

---

**Edit** — [kgeee34](https://www.reddit.com/user/kgeee34/) wrote in to talk about [ApexDoc](https://gitlab.com/StevenWCox/sfapexdoc/-/wikis/home); I've linked the version of the project that is being actively maintained, as the SFDC repo has been abandoned. It generates Markdown pages that self-document your Apex code — perfect for being hosted on a developer wiki site or even within your repo itself.

The original version of [Refactoring Trips & Tricks can be read on my blog.](https://www.jamessimone.net/blog/joys-of-apex/refactoring-tips-and-tricks/)

---

**Postscript**

For those following along, you'll note that for the first time in a while, there was a considerable delay in article publication times. Those delays may continue. My fiance and I adopted a puppy ... suffice it to say, my writing time is at an all-time low. On the other hand, we have an adorable little hound named Buckwheat romping around, and having him has been a blast so far:

![The young Buck](/img/young-buckwheat.jpg)
