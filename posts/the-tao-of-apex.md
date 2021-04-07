> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> The Tao Of Apex

> :Author src=github,date=2021-02-27T15:12:03.284Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

We owe our ability to understand abstractions in programming to philosophy; much as we owe a debt to mathematics for putting the theorems responsible for our code -- and computers -- to work into words. Consider the immortal words present in the Tao:

> A well-shut door will stay closed without a latch. Skillful fastening will stay tied without knots.

One does not simply (walk into Mordor) build a door that works well. A factory for doors cannot provide you with the quality of worksmanship and perfect fit that something custom can provide. This bespeaks the utmost importance placed on domain knowledge when it comes to making code work well for an organization; our perfectly coded door comes from our knowledge of the space in which the door will be placed.

On the subject of knots, there is an implicit parallel to how well-produced, loosely coupled code works. Indeed, in our day-to-day journeys through code we haven't written, one hears the following epithet slung around frequently: _spaghetti code_. That scornful phrase comes, etymologically, from the very knots mentioned in the Tao! For me, it brings to mind the scene in _Maniac Magee_ where the hero unties a knot that has stymmied the town for decades. Untying knots in code? We know that as refactoring.

The Tao also says:

> Advancing in the Tao seems like regression. Settling into the Tao seems rough.

Becoming knowledgeable in any subject matter involves quite a bit of work. Becoming knowledgable about Salesforce development comes with many caveats:

- it helps to already have a broad understanding of how browsers work, and how frontend development proceeded on the web over the past decade (the eventual move from server-side to client-side rendering, for better or for worse). In this way, understanding how Visual Force, Aura, and Lightning Web Components work becomes much easier
- it helps to understand the history of the company as a whole, and how declarative automation is frequently used as the selling point; this gives you the context necessary to understand obscure workarounds put in place between old Workflow Rules, more recent Process Builders, and now (thankfully) the increasingly sane automations produced by Flow
- having a background in computer science helps, but in particular having a strong working knowledge of databases helps immensely. Triggers in Apex are just an abstraction over Oracle (or SQL) database triggers

These things are "nice to haves." They aren't necessary or required by any means; however, I think that because people start to investigate the Salesforce ecosystem from the top down, they're frequently either scared off or unimpressed by the knowledge necessary and the tooling that exists.

There is a _flow_ that occurs when you start to get comfortable developing in this ecosystem. "Flow" as a state of being is also an abstract concept as much a part of the Tao -- and many subsequent generations of books -- as it is something talked about in sports, in programmaing, and in life:

> Do without "doing" - Lao Tzu, Tao Te Ching

When you're in the programming _zone_, it doesn't matter what language you're writing code in. You're no longer really even thinking about what you're doing; you're just iterating toward a vague goal that rapidly materializes. Today, I'd like to explore that zone -- similar to [Idiomatic Apex](/idiomatic-salesforce-apex) and [Naming Matters In Apex](/naming-matters-in-apex) in the sense that we'll be examining some common pitfalls I've seen in codebases. I call them "pitfalls" because drudgery keeps us from getting into the zone; as such, we empower ourselves to enter into a flow state more frequently when we're taking advantage of the standard library when that enables us to do our jobs more easily.

## Getting Into The Programming Zone

How do we enter into a flow state while programming? There's no one right way. Personally, I find that establishing guard rails allows me to get in the zone quickly. I start by writing a failing test for the functionality I'm looking to develop. As well, when I uncover what I like to refer to as "poisonous code", I try to refactor it quickly (whenever possible); I also add tests to ensure that my refactorings aren't breaking the pre-existing nature of the code.

Here's an extremely simple example from several years ago. While working on an ecommerce site that wanted to host image galleries specific to product reviews, I found that there were instances of whitespace within the `String`s I was working with that needed to be sanitized so that the product in question could correctly be keyed to its reviews (and the images associated with them). There was already a utilities directory in our codebase, and a file dedicated to string helpers; in it, I found this gem:

```typescript
const removeLastNCharacters = (string: string, number: number) => {
  var stringToRemove = new RegExp(".{" + number + "}$", "i");
  return string.replace(stringToRemove, "");
};
```

😮. First of all -- it costs CPU cycles to compile regular expressions. They should always be constants for that reason. Re-declaring the regex in this case is needlessly wasteful. That's more of an aside -- this method is insane. There's no need for a dense and hard to understand regular expression -- removing characters from strings is a part of the basic JavaScript library. In keeping to my word, I first added in a test (which didn't exist previously) to validate that the existing code worked:

```typescript
import { removeLastNCharacters } from "../strings";

describe("Strings", () => {
  it("should remove last n characters", () => {
    const startingString = "blablaremovelast5";
    const expectedEndingString = "blablaremove";

    const actualEndingString = removeLastNCharacters(startingString, 5);
    expect(expectedEndingString).toEqual(actualEndingString);
  });
});
```

Not my finest work, but it gets the job done. With that done, I was free to perform the single most satisfying refactoring in my career:

```diff
const removeLastNCharacters = (string: string, number: number) => {
-  var stringToRemove = new RegExp(".{" + number + "}$", "i");
-  return string.replace(stringToRemove, "");
+  return string.slice(0, string.length - number);
};
```

As [Suraj](https://github.com/surajp/) noted while reviewing this excerpt, there's indeed a method to the madness in keeping this as a function; it can be easy to forget whether it's `splice` or `slice` that you're looking to use for this functionality.

Though this refactor was only tangentially related to the feature I had actually been tasked with working on, it added test coverage and fixed a nasty piece of code at the same time. It immediately put me into the zone, and being in that flow accelerated my pace of development on what I was actually working on. That I remember it fondly to this day speaks to the empowering nature of iterating on code. Keeping a codebase clean, or improving the existing quality of an older system, gives us the chance to get in small wins throughout the day; those victories help carry us through the harder times of grokking the seemingly alien intent of departed developers (or the difficulties present in implementing new features in a complicated existing system).

Does the idea of detouring from your existing responsibilities seem frightening? Remember what the Tao has to say about strategy:

> I prefer to be able to move, rather than be in a fixed position. I prefer to retreat a foot rather than advancing an inch.

There's a reason that people talk about the power of lateral thinking. Sometimes the trick to entering into a flow state is to just change the problem you're working on for a few moments. Writing tests helps, too -- even if you're not exactly familiar with how to go about writing a failing test, that kind of _lateral learning_ can help you to enter into a flow state more easily. When I was first learning Lightning Web Components, I didn't know how to mock the results of an Apex method being referenced by my component -- so I went to the [Trailhead LWC repo](https://github.com/trailheadapps/lwc-recipes) for some inspiration. After seeing how easy it was to register mocked data through Jest for `@wire` decorated functions, I was well on my way.

Sometimes in order to move forward, we have to take two steps back.

## Embrace The Unknown

What does the Tao have to teach us about being vulnerable while programming; in an industry so beset by big egos, how can we empower ourselves to keep learning when the first step in learning is admitting that you don't know the answer to something?

> There is nothing better than to know that you don't know. Not knowing, yet thinking you know -- this is sickness. Only when you are sick of being sick can you be cured ... the further you go, the less you know.

Owning up to not knowing the answer to something empowers you to enter future flow states through the feeling of gratitude. Remaining grateful for the opportunities present to you as you keep programming keeps every day interesting. One of my founding tenets when I began writing [The Joys Of Apex](/) was to create a place that celebrated the work that we do each day on the platform, in some small hope that even the most jaded writer of code might find some fun fact or tidbit here and enjoy the work they do _a little bit more_.

There is a great deal of uncertainty that goes into fulfilling feature requests for our employers and clients. This is the great wheel of software development:

- get asked to do something
- learn about what will be necessary to implement said feature
- decide to actually create something or to hook into something existing if the time/actual cost is deemed worth it
- rinse and repeat

There's a corollary to the above -- and it comes as a codebase matures. Code that was once fresh and filled with clarity and purpose is now guarded by conditionals; what was once a safe haven is now an overgrown garden. There's a reason I like to use the phrase: **reduce, reuse, refactor** -- these are the words we can use in almost any setting within the codebase to keep things fresh. And, indeed, we can see that the Tao knows about how small changes can become complicated and ingrained; it also offers a hint as to the path we must tread when dealing with what accumulates through many "small" changes being made:

> The difficult problems in life always start off being simple ... much ease turns into much difficulty. Therefore the sage treats things as though they were difficult, and hence never has difficulty.

Remember that all code ages. The best things we write are revisited time and time again -- either for inspiration, or to keep them clean. Without maintenance, the tarnish sets in. Which leads us to ...

## Tell Your Story Through Code

Good code works. _Great_ code tells a story about _how_ it works. This is something we've already discussed in [Naming Matters In Apex](/naming-matters-in-apex/), but it's worth repeating again -- sometimes the best code in the world is elevated to that status because of a well-placed comment. The Tao knows all about the illuminating power of a well-placed comment:

> The sage squares things without cutting, edges without separating; straightens without lining up, shines but does not glare.

Consider the following segment, part of [LWC Utils' custom datatable component](https://github.com/tsalb/lwc-utils/):

```js
// from https://github.com/tsalb/lwc-utils/blob/master/utils-core/main/default/lwc/datatable/datatable.js

// Keeps lexical scope correct
handleEditableCellRendered = () => {
  // This event is emitted from every editable cell, which is why needs to be debounced
  window.clearTimeout(this._delayEditableCellRendered);
  this._delayEditableCellRendered = setTimeout(() => {
    // Editable cells need these even if the pencil icon is not enabled
    this._initializeLookupConfigData();
    this._initializeRecordTypeIdData();
  }, 500);
};
```

The comments _absolutely make_ this section of code readable!

- First off, we learn immediately why the function is declared with fat arrow syntax -- to keep `this` bound to the component as a whole
- We also learn that the function needs to be debounced -- which, in and of itself is useful information, because the reader _may not even know what debouncing is until reading this!_
- There are prereqs scattered throughout the datatable, and the last comment informs the reader that there are two operations necessary for any editable cell

Without those comments, the purpose of the function -- and the reason for its deviation in terms of style of declaration -- are obscured for the newer reader of JavaScript. Indeed, reading a comment like the first one shown can help the reader in many such future situations (especially in a consistent codebase): much as iterating through a list in reverse in Apex should be a sign that elements are going to be removed from the list, seeing a fat arrow function in JavaScript should telegraph to the reader: _we need to preserve the value of `this` here_.

In some circles (and here we return to the subject of ego ...), the expectation is that you have to be "at a certain level," to understand good code; that if you don't "get it," you're not worthy. Once again, the Tao to the rescue:

> True words are not fancy. Fancy words are not true ... the sage does not hoard. She gives people her surplus. Giving her surplus to others, she is enriched.

One of the best things about reading [James Hou's code](https://github.com/tsalb) comes from the obvious pains he takes in comments like the ones shown to give back. There's no ego involved with leaving a note to yourself -- and to other developers -- your rationale for doing something. As a result, his repositories have become a one-stop-shop for learning about LWC in particular, and modern Salesforce development in general.

Give your code a voice, and you set yourself up (and the ones that will come after you) for success. In writing this, it made me realize I needed to revise where I'd put a crucial comment in [Rollup](https://github.com/jamessimone/apex-rollup):

```java
private static List<SObject> getMetadataFromCache(SObject metadataRecord) {
  // CMDT is read-only when returned from the cache
  Map<String, SObject> metadataMap;
  switch on metadataRecord {
    when Rollup__mdt rollupMeta {
      metadataMap = Rollup__mdt.getAll();
    }
    when RollupControl__mdt rollupControl {
      metadataMap = RollupControl__mdt.getAll();
    }
  }
  return metadataMap?.deepClone().values();
}
```

Instead of having the comment at the top, it belongs with the actual clone statement; it also deserves a bit more explanation:

```diff
private static List<SObject> getMetadataFromCache(SObject metadataRecord) {
-  // CMDT is read-only when returned from the cache
  Map<String, SObject> metadataMap;
  switch on metadataRecord {
    when Rollup__mdt rollupMeta {
      metadataMap = Rollup__mdt.getAll();
    }
    when RollupControl__mdt rollupControl {
      metadataMap = RollupControl__mdt.getAll();
    }
  }
+ // CMDT is read-only when returned from the cache
+ // use "deepClone" to get access to mutable versions
+ // of the CMDT records
  return metadataMap?.deepClone().values();
}
```

Ahhh. There we go. Also, while we're here -- this is an interesting and underexplored topic concerning `switch` statements and CMDT that I think is worth talking about. Because CMDT records have been exposed in Apex as implementing the common `SObject` interface, we can actually call this method using one of the two custom metadata records we expect:

```java
List<Rollup__mdt> rollupMetadata = getMetadataFromCache(new Rollup__mdt());
```

You don't even need to cast the list to its specific type! Because we're able to spin up "empty" CMDT in-memory, we can take advantage of the syntax sugar built into Apex's `switch` statement. It's a shame that `switch` does not yet support the same operations for the generic `SObjectType` token (which is essentially what the "syntax sugar" in those `when` statements is doing). Let's look at two other ways of doing this:

```java
private static List<SObject> getMetadataFromCache(SObject metadataRecord) {
  // comments omitted for brevity
  Map<String, SObject> metadataMap;
  if(metadataRecord.getSobjectType() == Rollup__mdt.SObjectType) {
    metadataMap = Rollup__mdt.getAll();
  } else if(metadataRecord.getSObjectType() == RollupControl__mdt.SObjectType) {
    metadataMap = Rollup__mdt.getAll();
  }
  return metadataMap?.deepClone().values();
}
```

Of course, now that we're navigating away from the syntax sugar present in the `switch` statement, we can do better by changing the method signature:

```java
private static List<SObject> getMetadataFromCache(SObjectType metadataType) {
  Map<String, SObject> metadataMap;
  if (metadataType == Rollup__mdt.SObjectType) {
    metadataMap = Rollup__mdt.getAll();
  } else if (metadataType == RollupControl__mdt.SObjectType) {
    metadataMap = RollupControl__mdt.getAll();
  }
  // CMDT is read-only when returned from the cache
  // use "deepClone" to get access to mutable versions
  // of the CMDT records
  return metadataMap?.deepClone().values();
}
```

So ... now we really come to the crux of it -- which method is best? The `switch` statement _looks_ nice, but in reality coupling the method signature to an `SObject` type obscures what's actually happening within the method itself. In this case, I'm going to have to go with the if statement, because it won't engender any questions later on when myself (or somebody else!) visits this code. And, in weighing the pros and cons of each approach, I found myself in a flow state unexpectedly; I didn't so much make the decision about which method was better so much as it came to me.

---

## Tao Closing Thoughts

What gets you into the flow of programming? I don't think there's one consistent way that works for people -- some have a lot of success in achieving a flow state by watching videos about programming; some thrive on getting inspiration from books. Sometimes the easiest way for me to achieve a flow state is to simply start refactoring something, or writing tests to prove a hypothesis. Some of the best ideas on this blog -- [Dynamic APIs](/extendable-apis/) and dynamically scaling [Batchable & Queueable Apex](/batchable-and-queueable-apex) came out of ideas generated _while in the midst of doing something else_. Even if you don't have a chance at that exact moment to make something of the thought you're having, write it down, put a note in your phone, or verbalize the thought so you won't lose track of it later.

As well, keep track of how you get into the zone, and when those moments of flow occur. Just as we try to follow steps to reproduce bugs as they're reported, so too can you more consistently achieve a flow state once you know how to get yourself ticking. Achieving these elevated moments of mental clarity and excitement can also help with the drudgery that I mentioned at the start of this article; sometimes you need to save the particularly tedious work till you're in such a state. Cultivating a satisfying and consistent repertoire (and this frequently extends outside of programming as well; almost every time I'm "stuck" on something, I figure out how to proceed while on a run, and only after I've stopped consciously thinking about the problem at hand) creates mental space where you can thrive, and help others thrive as well.

--

# Postscript

Tuesday, February 16th 2021 was my last day with Publicis Sapient. After two years of consulting, I was approached by a team at Salesforce about going to work for them, and I'm excited to announce that next week I'll start my new job there. I have nothing but positive things to say about my time at Publicis; they have a great Salesforce team, and I was extended many opportunities to lead during my brief tenure there. That I leave behind some newfound friends is a bittersweet part of this change, but it's long been a dream of mine to work for Salesforce. I expect that I will continue to author posts here; thanks for staying with me on this journey, and I hope this post leaves you with some good food for thought.

The original version of [The Tao Of apex can be read on my blog](https://www.jamessimone.net/blog/joys-of-apex/the-tao-of-apex/) - it is mirrored here for your enjoyment!
