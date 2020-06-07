> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> React Versus Lightning Web Components

> :Author src=github

I'm in the midst of writing a "back to basics" [post on object-oriented programming](/apex-object-oriented-basics), which has been a popular request for some time now. I was de-railed while working on that post after observing some other people talking about [Lightning Web Components](https://developer.salesforce.com/docs/component-library/documentation/lwc) (LWC), the new-ish Salesforce frontend framework that has rapidly been pushed out the door to faze out the badly-aging Aura framework upon which Salesforce Lightning was first designed. LWC itself is based upon the open-source [Web Components](https://developer.mozilla.org/en-US/docs/Web/Web_Components) standard, care of the great people at Mozilla.

On the backend, I come from a .Net / Java background, which made diving into Apex fairly easy. On the frontend, I worked on some old Backbone / Handlebars / Angular codebases, prior to making the jump into developing websites with React. By the time LWC came out, React had already begun favoring the usage of function components over class-based components, but the similarities were certainly there between the two. In truth, LWC shares more similarities to Vue.js than it does to React, but according to the [2019 State Of JavaScript](https://2019.stateofjs.com/front-end-frameworks/), React is still the frontend framework leader in terms of market-share. Comparisons between LWC and React are inevitable as a result.

Doing a little cross-comparison between the two frameworks seems like a fun exercise; specifically, I'm curous to see if there are significant performance differences between LWC and React.

## Testing In A React/Typescript Component

This sample comes from a Typescript/React codebase for a client who needed to display an FAQ section on their site. If you're not familiar with Typescript/React, don't worry! Take a skim through and see if you recognize anything (or simply scroll through). See if you facepalm, as I did after re-reading what I'd written:

```typescript
//in faq.tsx
import React, { FC, Reducer, useReducer } from "react";

type Action = {
  type: string;
};

type FAQ = {
  answer: string;
  question: string;
};

type FAQProps = {
  faq: FAQ[];
};

type State = {
  [key in string]: boolean;
};

const getInitialState = (faq: FAQ[]) =>
  faq
    .map((frequentlyAsked) => ({
      name: frequentlyAsked.question,
      isExpanded: false,
    }))
    .reduce(
      (previousValue, currentValue) => {
        return {
          ...previousValue,
          [currentValue.name]: currentValue.isExpanded,
        };
      },
      { base: false }
    );

const reducer: Reducer<State, Action> = (
  state: State,
  action: Action
): State => {
  const isExpanded = !state[action.type];
  return { ...state, [action.type]: isExpanded };
};

const HideableSpan = ({ isExpanded }) => {
  const transformStyle = `rotate(${!!isExpanded ? 90 : 0}deg)`;
  return (
    <span
      style={{
        display: "block",
        marginLeft: "-15px",
        position: "absolute",
        top: 0,
        transform: transformStyle,
        transition: `ease 0.3s`,
      }}
    >
      →
    </span>
  );
};

export const FAQ: FC<FAQProps> = ({ faq }) => {
  const initialState = getInitialState(faq);
  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <section>
      <h1>FAQ</h1>
      {faq.map((frequentlyAsked) => (
        //style omitted for brevity
        <div
          key={frequentlyAsked.question}
          onClick={() =>
            dispatch({
              type: frequentlyAsked.question,
            })
          }
        >
          <h2>
            {frequentlyAsked.question}
            <HideableSpan isExpanded={state[frequentlyAsked.question]} />
          </h2>
          //styling not displayed for brevity //but similar to the HideableSpan
          <small isExpanded={state[frequentlyAsked.question]}>
            {frequentlyAsked.answer}
          </small>
        </div>
      ))}
    </section>
  );
};
```

This is a pretty minimal component that takes in a list of frequently asked questions and makes use of the lazily-loaded `useReducer` pattern for creating initial state, where all of the questions are mapped to a state object with the question used as a key and a boolean representing their expanded value. Clicking on the question shows the answer -- clicking again re-hides the answer. Fairly standard stuff for React. Probably the only notable thing about this example is the use of `useReducer` in general, because the _simplest_ possible solution in React would be to `useState` ... except that here, that would already be pretty complicated, because we don't know how many questions are going to be loaded into this component to begin with.

Even though this is a relatively simple piece of code, it's also a mess. Most of the mess is contained within `getInitialState()`, which is essentially flattening the list of frequently asked questions into an object, as described. Why is it a mess? It's hard to follow, particularly the call to the native JS function `reduce`. It compiles and it works, but it's also totally inscrutable, particularly if anybody other than me should ever work on this codebase. What the hell is that `{ base: false }` section even doing, for example?

Let's look at how that `getInitialState` function might be suitably ... reduced to something more understandable:

```typescript
const getInitialState = (faq: FAQ[]) =>
  faq
    .map((frequentlyAsked) => ({
      [frequentlyAsked.question]: false,
    }))
    .reduce((previousValue, currentValue) => ({
      ...previousValue,
      ...currentValue,
    }));
```

Now we're starting to get somewhere. Most people would probably take this as an acceptable solution and move on. But, to quote Mr. Money Mustache on the subject of coffee ... ["how much is that bitch costing ya?"](https://www.mrmoneymustache.com/2011/09/06/how-much-is-that-bitch-costin-ya/). People love love _love_ to use `.map` and `.forEach` and `reduce` in JS, without regards to performance -- and, if this component were to be frequently re-rendered with a suitably large list of questions, iterating twice over the list of FAQs could indeed become a performance bottleneck (not to mention mapping over the values once more in the actual render method of the component). It's something that should at least be measured, so let's create an even faster FAQ component and use Jest + Enzyme to measure the costs of both components updating:

```typescript
//in faq.tsx
export type FAQItem = {
  answer: string;
  question: string;
};

type FAQProps = {
  faq: FAQItem[];
  getInitialState?: (faq: FAQItem[]) => State;
};

//....

export const FAQ: FC<FAQProps> = ({ faq, getInitialState }) => {
  const initialState = !!getInitialState
    ? getInitialState(faq)
    : getInitialStateDefault(faq);
  //..
};
```

You could get much crazier than that, and I considered it, but sometimes simple is best. Let's look at how these tests shape up:

```typescript
import { mount } from "enzyme";
import React from "react";

import { FAQ } from "../faq";
import { FastFAQ } from "../fast-faq";

const getList = () => {
  const list = [];
  for (let index = 0; index < 1000; index++) {
    list.push({ question: index, answer: "some answer" });
  }
  return list;
};

const bigOldList = getList();

const fastInitialState = (args: FAQItem[]) => {
  const initialState = {};
  for (let index = 0; index < args.length; index++) {
    const frequentlyAsked = args[index];
    initialState[frequentlyAsked.question] = false;
  }
  return initialState;
};

describe("FAQ Performance", () => {
  it("should render faq", () => {
    const wrapper = mount(<FAQ faq={bigOldList} />);
    wrapper.update();
  });
  it("should render fast-faq", () => {
    const wrapper = mount(
      <FAQ faq={bigOldList} getInitialState={fastInitialState} />
    );
    wrapper.update();
  });
});
```

And the results?

```bash
  FAQ Performance
    √ should render faq (200ms)
    √ should render fast-faq (145ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

Not too shabby. Even when the list of questions was "only" 100 questions long (and keeping in mind the fact that longer answers would almost certainly negatively impact re-rendering performance), the difference between re-renders was consistently at least 50ms. UX research has suggested that as _little_ as 50ms in delay can negatively affect users, both in terms of conversion and (for internal portals) assignment completion.

In short, small delays in rendering/re-loading pages quickly add up; as developers, it shouldn't only be our mandate to make things work, but to make things work _well_. Knowing about relative performance, particularly when branching out into LWC development -- where the JavaScript you write is going to have to be processed client-side for your users -- is not only important for you as the programmer when you need to return to code, but because most users operate on substandard hardware that chug on huge quantities of JS and CSS.

---

One thing that's really pleasant, as a developer, when working with the above code, is how testable the implementation is. You can easily, for example, test that the implementation of `getInitialState` in FAQ creates state predictably, with a minimum of fuss -- all you need to do is pass in a list of objects with `question` and `answer` properties to validate that things are working as anticipated. Furthermore, thanks to the power of Jest + Enzyme (not to mention the whole host of other React testing libraries out there), we can actually examine the internals of the rendered component to validate that, when a particular question is clicked, the `HideableSpan` component actually rotates the arrow, and the text of the answer is exposed.

At a high level, this is precisely why React has gained the prominence it now has within the frontend community -- by splitting the traditional [MVC](https://en.wikipedia.org/wiki/Model%E2%80%93view%E2%80%93controller) architecture into discrete, testable presentation pieces, React encourages code re-use and abstraction at a similar level to the foundations of object-oriented programming represented by a language like Apex.

## Testing In A Lightning Web Component

Let's make the jump and look at this same problem, this time within a LWC.

There are many, _many_ ways to skin this particular cat, highlighting both the strengths and weaknesses of LWC in a nutshell. In order to ingest the FAQ question/answer pairs, for example, you could use `@wire` to fetch data from a custom object using an Apex controller. You could use `@api` and getter/setter methods to control the `isExpanded` property that we need to track in order to expand/contract the FAQ question to show the answer.

Here's the _most_ basic implementation for the LWC:

```javascript
import { LightningElement, wire } from "lwc";
import getFAQs from "@salesforce/apex/FAQController.getFAQs";

export default class FAQList extends LightningElement {
  @wire(getFAQs) faqs;
  activeSections = [];
}
```

The controller:

```java
public class FAQController {
  @AuraEnabled(cacheable=true)
  public static List<FAQ> getFAQs() {
    List<FAQ> faqs = new List<FAQ>();
    for(Integer index = 0; index < 100; index++) {
        String indexString = String.valueOf(index);
        faqs.add(new FAQ('Question for ' + indexString, 'Answer for' + indexString, indexString));
    }
    return faqs;
  }

  public class FAQ {
    public FAQ(String question, String answer, String key) {
        this.question = question;
        this.answer = answer;
        this.key = key;
    }
    public String question { get; private set; }
    public String answer { get; private set; }
    public String key { get; private set; }
  }
}
```

And the LWC HTML template:

```html
<template>
  <template if:true="{faqs.data}">
    <template for:each="{faqs.data}" for:item="faq">
      <lightning-accordion
        allow-multiple-sections-open
        key="{faq.key}"
        active-section-name="{activeSections}"
      >
        <lightning-accordion-section name="{faq.key}" label="{faq.question}">
          <small>{faq.answer}</small>
        </lightning-accordion-section>
      </lightning-accordion>
    </template>
  </template>
</template>
```

And the tests:

```javascript
import { createElement } from "lwc";
import { registerApexTestWireAdapter } from "@salesforce/sfdx-lwc-jest";

import FAQ from "c/faq";
import getFAQs from "@salesforce/apex/FAQController.getFAQs";

const FAQ_AMOUNT = 1000;

const getFakeFAQs = () => {
  const faqs = [];
  for (let index = 0; index < FAQ_AMOUNT; index++) {
    faqs.push({
      question: "test question" + index,
      answer: "test answer " + index,
      isExpanded: false,
      key: index,
    });
  }
  return faqs;
};

const getFAQAdapter = registerApexTestWireAdapter(getFAQs);

function assertForTestConditions() {
  const resolvedPromise = Promise.resolve();
  return resolvedPromise.then.apply(resolvedPromise, arguments);
}

describe("FAQ", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  describe("FAQ tests", () => {
    it("renders full faq list", () => {
      const element = createElement("faq-list", {
        is: FAQ,
      });

      document.body.appendChild(element);
      getFAQAdapter.emit(getFakeFAQs());

      return assertForTestConditions(() => {
        expect(
          element.shadowRoot.querySelectorAll("lightning-accordion-section")
            .length
        ).toBe(FAQ_AMOUNT);
      });
    });

    it("expands and contracts on click", () => {
      const element = createElement("faq-list", {
        is: FAQ,
      });
      document.body.appendChild(element);
      getFAQAdapter.emit(getFakeFAQs());

      //get the first anchor and test clicking it
      assertForTestConditions(
        () =>
          element.shadowRoot
            .querySelector("lightning-accordion-section")
            .click(),
        () =>
          expect(element.shadowRoot.querySelectorAll("small").length).toBe(1)
      );
    });
  });
});
```

This leads to the following output:

```bash
  FAQ
    FAQ tests
      √ renders full faq list (415ms)
      √ expands and contracts on click (430ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

You'll notice that I didn't include the test for expanding/contracting when reviewing the React version of this component. This is partially because I expect readers to be less familiar with Typescript/React, and because that discussion was more about how simple JavaScript enhancements can lead to big increases in render speed. Here, the conversation is a little different:

- we aren't really "mounting" the LWC component a la Enzyme -- a shame, because it makes end-to-end comparisons between the two frameworks difficult, as far as speed is concerned
- the conditional logic isn't tied to CSS styling, as it is with React -- it's literally baked into the templating framework for LWC, which means that we aren't testing the CSS of the component to ensure it renders correctly, but rather that the element is correctly inserted into the DOM. I don't consider this to be a strength of the framework, as one of the reasons I was glad to move away from things like Handlebars was due to that invisible coupling between logic and HTML.
- optimizations for iterating through large lists of components are partially tied to the framework. I say "partially" because pagination is of course a necessary part of displaying large lists of information to consumers; pagination is a framework-agnostic performance optimization (so there's no "FastFAQ" LWC to be created)

A few takeaways:

- while it's nice that we achieve separation of concerns by the controller fetching the FAQ's separate from the rest of the component, the framework is still nascent, and it's awkward that you have to both inject the component into the DOM AND use a helper function just in order to load up your test data
- there's a lot of boilerplate going into the tests -- which I only partially reduced through the use of my "thennable" assert function
- there's no way to perform an end-to-end test with the Apex controller and the LWC. This is disappointing: while I'm a huge proponent of unit tests in general, the fact that you _can't_ even return mock data in your Apex controller and see that data flow into your component represents a weak point in the framework: you can have unit tests for both your Apex controller and your LWC, but you can't directly validate that somebody changing the controller doesn't mess up the data your component is supposed to be ingesting

With those things being said, it's my hope that the `@salesforce/sfdx-lwc-jest` library will continue to expand, offering developers better options for feeding their LWC data

## Revisiting React To Test Clicking

Let's re-visit the Typescript/React implementation, swapping out the heavy-lefting `mount` call to Enzyme with the more-performant `shallow` renderer (to try to get closer to an apples-to-apples comparison between the two frameworks). I'll add in a test for clicking one of the FAQ questions, with the caveat that normally I would be using a CSS-in-JS library and actually using helper functions to assert that the styles matched after clicking. This is an important distinction between ecosystems, however -- it's easy to use soomething like Emotion or Styled Components with React and then verify that styles have updated correctly using helper functions provided by those self-same libraries.

This is also exactly what I am hoping will happen within the LWC community -- it would be awesome to see something like hot module reloading (HMR) when developing LWC, for example, and HMR was an open-source contribution within the ecosystem of frameworks that uses Webpack to bundle their code ... so it's certainly possible.

Anyway:

```typescript
import { shallow } from "enzyme";
import React from "react";

import { FAQ } from "../faq";
import { FastFAQ } from "../fast-faq";

const listCount = 1000;

const getList = () => {
  const list = [];
  for (let index = 0; index < listCount; index++) {
    list.push({ question: index, answer: "some answer" });
  }
  return list;
};

const bigOldList = getList();

describe("FAQ", () => {
  it("should render faq", () => {
    const wrapper = shallow(<FAQ faq={bigOldList} />);
    expect(wrapper.getElements()[0].props.children[1].length).toBe(listCount);
  });
  it("should render fast-faq", () => {
    const wrapper = shallow(<FastFAQ faq={bigOldList} />);
    expect(wrapper.getElements()[0].props.children[1].length).toBe(listCount);
  });
  it("should toggle isExpanded on click", () => {
    const wrapper = shallow(<FastFAQ faq={bigOldList} />);
    wrapper.getElements()[0].props.children[1][0].props.onClick();
    expect(
      wrapper.getElements()[0].props.children[1][0].props.children[1].props
        .isExpanded
    ).toBeTruthy();
  });
});
```

This leads to the following output:

```bash
  FAQ
    √ should render faq (235ms)
    √ should render fast-faq (61ms)
    √ should toggle isExpanded on click (97ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```

When testing components as their own strict unit (which is what `shallow` does within Enzyme, as opposed to simulating the load of the whole DOM), there's no denying that React can be absurdly fast. I've worked on large React applications, and have seen firsthand how well the framework can scale.

## Wrapping Up: React Versus Lightning Web Components

Some people are sidestepping the whole question of which framework is better by [embedding React applications into their Lightning application pages.](https://github.com/ccoenraets/lightning-container-component-samples/tree/master/force-app/main/default/aura/lccSampleReact). I ... probably wouldn't recommend doing that.

I feel as though I am still holding out on LWC. On the one hand, I like how composable the framework can be through the use of `<slot>` components and the `<c-component-name>` binding. On the other, I still prefer the explicit binding between imported components in React; it's one less step to see where all of your components are being used -- but perhaps at some point there will be "View Usage" functionality for LWC.

Rendering performance with LWC still leaves something to be desired. While certainly faster than the components that were being built out with Aura (and I don't miss those days at all), LWC still feels relatively sluggish compared to components rendered with Vue or with React. I would be interested in hearing about other performance optimizations that people have found helpful in their LWC usage.

How do you feel about LWC? Was this comparison with React interesting to you? Let me know in the comments! I've seen some pretty impressive components built out already, and I'm looking forward to building more and seeing the framework achieve mainstream adoption and better tooling support within the SFDC ecosystem. If you'd like to peruse the code from this example, please refer to my [GitHub's LWC branch](https://github.com/jamessimone/apex-mocks-stress-test/tree/lwc-react-comparison).

Stay tuned for my [Apex Object-Oriented Programming Basics](/apex-object-oriented-basics) post. Till then, thanks for reading - if you liked this post, check out my post on creating a [composable pagination component](/lwc-composable-pagination)!
