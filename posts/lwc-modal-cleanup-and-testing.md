> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> LWC Modal Cleanup And Testing

> :Author src=github

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

If you had told a handful of people from the [SFXD Discord](https://discord.gg/xaM5cYq) would spend most of our Friday night and weekend working on a better focus-trap for the [modal article I published on Friday afternoon](/lwc-composable-modal), I would have laughed. My typical _modus operandi_ when writing begins with brainstorming furiously, often for weeks at a time, followed by a relaxing moment of catharsis as soon as I've published. While I frequently refer back to my own documentation on subjects I want to brush up, the initial relief of having documented something thoroughly often means that I don't revisit things for weeks or even months at a time.

With the modal, it was not to be -- and for good reason! I'm glad that both on the testing front and the effort to properly detect `<slot>`-based, focusable, markup proved to be so intriguing for the community at large. I've updated [my Github repo for the modal](https://github.com/jamessimone/lwc-modal) with the results -- and the commit history's all there, for anyone interesting in the rapid-fire iteration.

## The Focusable Honeytrap

[PSB](https://github.com/surajp) deserves full credit for working on a deterministic way to allow users to cycle through all focusable elements within the modal, regardless of whether those elements came from markup injected by way of `<slot>`. This is what things ended up looking like within the JavaScript controller:

```javascript
import { api, LightningElement } from "lwc";

const ESC_KEY_CODE = 27;
const ESC_KEY_STRING = "Escape";
const TAB_KEY_CODE = 9;
const TAB_KEY_STRING = "Tab";

export default class Modal extends LightningElement {
  isFirstRender = true;
  isOpen = false;

  outsideClickListener = (e) => {
    e.stopPropagation();
    if (!this.isOpen) {
      return;
    }
    this.toggleModal();
  };

  renderedCallback() {
    this.focusGained = false;
    if (this.isFirstRender) {
      this.isFirstRender = false;
      document.addEventListener("click", this.outsideClickListener);
    }
  }

  disconnectedCallback() {
    document.removeEventListener("click", this.outsideClickListener);
  }

  @api modalHeader;
  @api modalTagline;
  @api modalSaveHandler;

  @api
  toggleModal() {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.focusFirstChild();
    }
  }

  @api
  get cssClass() {
    const baseClasses = ["slds-modal"];
    baseClasses.push([
      this.isOpen ? "slds-visible slds-fade-in-open" : "slds-hidden",
    ]);
    return baseClasses.join(" ");
  }

  @api
  get modalAriaHidden() {
    return !this.isOpen;
  }

  closeModal(event) {
    event.stopPropagation();
    this.toggleModal();
  }

  innerClickHandler(event) {
    event.stopPropagation();
  }

  innerKeyUpHandler(event) {
    if (event.keyCode === ESC_KEY_CODE || event.code === ESC_KEY_STRING) {
      this.toggleModal();
    } else if (
      event.keyCode === TAB_KEY_CODE ||
      event.code === TAB_KEY_STRING
    ) {
      const el = this.template.activeElement;
      let focusableElement;
      if (event.shiftKey && el && el.classList.contains("firstlink")) {
        //the save button is only shown
        //for modals with a saveHandler attached
        //fallback to the close button, otherwise
        focusableElement = this.modalSaveHandler
          ? this.template.querySelector("button.save")
          : this._getCloseButton();
      } else if (el && el.classList.contains("lastLink")) {
        focusableElement = this._getCloseButton();
      }
      if (focusableElement) {
        focusableElement.focus();
      }
    }
  }

  _getCloseButton() {
    let closeButton = this.template.querySelector('button[title="Close"]');
    if (!closeButton) {
      //if no header is present, the first button is
      //always the cancel button
      closeButton = this.template.querySelector("button");
    }
    return closeButton;
  }

  _getSlotName(element) {
    let slotName = element.slot;
    while (!slotName && element.parentElement) {
      slotName = this._getSlotName(element.parentElement);
    }
    return slotName;
  }

  async focusFirstChild() {
    const children = [...this.querySelectorAll("*")];
    for (let child of children) {
      let hasBeenFocused = false;
      if (this._getSlotName(child) === "body") {
        continue;
      }
      await this.setFocus(child).then((res) => {
        hasBeenFocused = res;
      });
      if (hasBeenFocused) {
        return;
      }
    }
    //if there is no focusable markup from slots
    //focus the first button
    const closeButton = this._getCloseButton();
    if (closeButton) {
      closeButton.focus();
    }
  }

  setFocus(el) {
    return new Promise((resolve) => {
      const promiseListener = () => resolve(true);
      try {
        el.addEventListener("focus", promiseListener);
        el.focus();
        el.removeEventListener("focus", promiseListener);
        setTimeout(() => resolve(false), 0);
      } catch (ex) {
        resolve(false);
      }
    });
  }
}
```

Some of the nicer key differences between this and [the controller you saw in the original article](/lwc-composable-modal):

- while there is still an outer click listener function, it's attached to the `document`, which feels better than going for the `window`. In addition, this click listener relies less on CSS classes than the original, which used the `.outerModalContent` selector to do its thing.
- take special note of the `focusFirstChild` and `setFocus` methods. This promise-based approach to rifling through the focusable elements -- and stopping as soon as one of the elements has been focused -- works really well. We do have to take special precaution to not focus elements that are outside the modal with this approach (since we are using the wildcard `*` query selector), so the `_getSlotName` method is employed to ensure that only elements within the modal try to get focused. Special thanks to **AndyV** on Discord for pointing out that the use of `setTimeout` is necessary because DOM events themselves are async (in comparison to custom events, which fire immediately); ceding control to the event loop allows the DOM event to actually fire on the first focusable element

The work to make the modal more accessible is ongoing. In an ideal world, the HTML `tabindex` property would also be factored in to ensure that screen readers know which element is currently focused, and which elements are focusable.

## Testing The Modal Using sfdx-lwc-jest

As I mentioned when comparing [React to LWC](/react-versus-lightning-web-components), we use `sfdx-lwc-jest` to create tests for our Lightning Web Components. Typically, tests for a LWC are located in a `__tests__` folder within the LWC's folder itself:

```
SFDX root (./force-app/main/default)
│
└───lwc
│ │ jsconfig.json
│ │
│ └───modal
| | |
| | └───__tests__
| | | modal.test.js
│ │ modal.js
│ │ modal.js-meta.xml
│ │ modal.html
│
└───classes
│ ...

```

Tests that make use of the `jest` test-runner use `describe` function calls to group associated tests. Within the `describe` function, individual tests supply logic using a combination of the `it` function, which names the test, and the `expect` library for performing assertions.

One piece of boilerplate that is required at the moment when using `sfdx-lwc-jest` is this `afterEach` call to do DOM cleanup:

```javascript
describe('modal tests', () => {
    afterEach(() => {
        //the dom has to be reset after every test to prevent
        //the modal from preserving state
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
    });
    ...
})
```

Lightning Web Component re-renders (triggered by changes to `@api` publicly tracked properties, or methods called on the component that update `@track` properties) occur _asynchronously_. For this reason, we have to pass a resolved promise to the jest test-runner in each test when asserting for async updates. I like to use a little helper function for this, but it's certainly not required:

```javascript
//just a little syntax sugar for testing
function assertForTestConditions() {
  const resolvedPromise = Promise.resolve();
  return resolvedPromise.then.apply(resolvedPromise, arguments);
}
```

To kick us off, let's look at how to test that the modal properly renders the header elements when set. In contrast to the unit tests that we've been covering here when discussing Apex, testing on the front-end is frequently much more on the integration side. For that reason, I tend to group assertions that belong together. In this case, since I'm essentially testing the output of the `template if:true` statement associated with the modal's header (shown below for clarity), I'm going to cover both that and the modal tagline in the same test:

```html
<template if:true="{modalHeader}">
  <header class="slds-modal__header" onclick="{innerClickHandler}">
    <button
      onclick="{closeModal}"
      class="slds-button slds-button_icon slds-modal__close slds-button_icon-inverse"
      title="Close"
    >
      <svg class="slds-button__icon slds-button__icon_large" aria-hidden="true">
        <use
          xlink:href="/apexpages/slds/latest/assets/icons/utility-sprite/svg/symbols.svg#close"
        ></use>
      </svg>
      <span class="slds-assistive-text">Close</span>
    </button>
    <h2 id="modal-heading-01" class="slds-modal__title slds-hyphenate">
      {modalHeader}
    </h2>
    <template if:true="{modalTagline}">
      <p class="slds-m-top_x-small">
        {modalTagline}
      </p>
    </template>
  </header>
</template>
```

And the test:

```javascript
import { createElement } from "lwc";

import Modal from "c/modal";

// the assertForTestConditions previously shown

describe("modal tests", () => {
  it("shows modal header elements when header is set", () => {
    const modal = createElement("c-modal", {
      is: Modal,
    });
    document.body.appendChild(modal);

    const headerElementBeforeHeaderSet = modal.shadowRoot.querySelector(
      ".slds-modal__header"
    );
    expect(headerElementBeforeHeaderSet).toBeNull();

    //setting an @api value on a LWC triggers a re-render,
    //but the re-render only completes in a resolved promise
    //you can gather variables to test the initial state
    //prior to returning the resolved promise to the test runner
    //but all updated state must be gathered / asserted for
    //within the promise
    modal.modalHeader = "Some Header";
    modal.modalTagline = "Some tag line";

    return assertForTestConditions(() => {
      const headerElementAfterHeaderSet = modal.shadowRoot.querySelector(
        ".slds-modal__header"
      );
      expect(headerElementAfterHeaderSet).not.toBeNull();
      expect(
        modal.shadowRoot.querySelector(".slds-modal__title").textContent
      ).toEqual("Some Header");

      const modalTagline = modal.shadowRoot.querySelector(
        ".slds-m-top_x-small"
      );
      expect(modalTagline.textContent).toEqual("Some tag line");
    });
  });
});
```

In this way, the _singular behavior_ of the template conditional is handled within the confines of one test. This feels like a good compromise in terms of grouping similar behavior into single tests. Note, as well, that when testing we don't have access to the `template` property of the component; instead, we use the `shadowRoot` property exposed by the `sfdx-lwc-jest`'s `createElement` object. Aside from having to mount this element into the DOM manually (and the aforementioned `querySelector` difference), the returned `modal` component behaves the way that you would expect a JavaScript object representation of the component to.

What else do we need to test for? When the modal is open, we want to ensure that the locking overlay is rendered. We also want to ensure that toggling the modal actually opens it ...

```javascript
it("shows the modal with backdrop when toggled", () => {
  const modal = createElement("c-modal", {
    is: Modal,
  });
  document.body.appendChild(modal);

  const backdropBeforeToggle = modal.shadowRoot.querySelector(
    ".slds-backdrop_open"
  );
  expect(backdropBeforeToggle).toBeNull();
  expect(modal.modalAriaHidden).toBeTruthy();

  modal.toggleModal();

  return assertForTestConditions(() => {
    expect(modal.modalAriaHidden).toBeFalsy();

    expect(modal.cssClass).toEqual("slds-modal slds-visible slds-fade-in-open");

    const backdropAfterOpen = modal.shadowRoot.querySelector(
      ".slds-backdrop_open"
    );
    expect(backdropAfterOpen).toBeTruthy();
  });
});
```

The use of the `modalAriaHidden` property is also a compromise, and one that you might choose to architect differently. This is because `modal.isOpen` is not an exposed property on the component.

---

OK, so we've tested the modal's public properties being set (aside from the save handler, but more on that later); now we're in the realm of opening and closing, so might as well cover those cases:

```javascript
it("hides the modal when outer modal is clicked", () => {
  const modal = createElement("c-modal", {
    is: Modal,
  });
  document.body.appendChild(modal);

  modal.toggleModal();

  return assertForTestConditions(() => {
    const anyOuterElement = modal.shadowRoot.querySelector(".slds-modal");
    anyOuterElement.click();
    //note that the positive case for the class
    //is already handled, in the above backdrop test
    expect(modal.cssClass).toEqual("slds-modal slds-hidden");
    expect(modal.modalAriaHidden).toBeTruthy();
  });
});

it("hides the modal when the esc key is pressed", () => {
  const modal = createElement("c-modal", {
    is: Modal,
  });
  document.body.appendChild(modal);

  modal.toggleModal();

  return assertForTestConditions(() => {
    const event = new KeyboardEvent("keyup", { code: "Escape" });
    modal.shadowRoot
      .querySelector('section[role="dialog"]')
      .dispatchEvent(event);
    expect(modal.modalAriaHidden).toBeTruthy();
  });
});
```

Something of special note when simulating keyboard presses/touches is that the event _must_ be dispatched from the DOM node containing the listener; when the modal was attaching the `keyup` listener to the `window`, it was `window.dispatchEvent` that needed to be used.

On the list of things left to be tested lies showing the save button when a save handler is provided:

```javascript
it("shows a save button when the modalSaveHandler is provided", () => {
  const modal = createElement("c-modal", {
    is: Modal,
  });
  document.body.appendChild(modal);

  let wasCalled = false;
  const modalSaveHandler = () => (wasCalled = true);
  modal.modalSaveHandler = modalSaveHandler;

  const saveSelector = `button[class="slds-button slds-button_brand save"]`;

  const saveButtonBefore = modal.shadowRoot.querySelector(saveSelector);

  return assertForTestConditions(() => {
    expect(wasCalled).toBeFalsy();
    expect(saveButtonBefore).toBeNull();

    const saveButtonAfter = modal.shadowRoot.querySelector(saveSelector);
    expect(saveButtonAfter).toBeTruthy();
    saveButtonAfter.click();
    expect(wasCalled).toBeTruthy();
  });
});
```

In more complicated cases, we can actually mock function calls using `jest.fn()` to ensure that the correct values are being passed, but since the handler will be specific to components implementing the modal (leaving no actual logic/passing necessary on the modal's side), that doesn't apply here.

The only big remaining section to test is how the modal chooses to trap focus and focus the first element. If we were testing the `modal_wrapper` example component, for example, we would want to verify that the first `lightning-input` element being passed in was focused. This onus on the consumer of the component is not ideal; I think there are more complicated test setups that would involve either directly manipulating the slotted `shadowRoot` elements of the modal or relying on the use of a single test wrapper component that was referenced throughout the codebase in order to verify that the focus function is working as intended.

I'd be curious to hear how people are handling slot-based logic in their components when writing tests. For now, I'll leave off with the tests that _are_ obvious; if there _isn't_ focusable markup, the modal is supposed to fallback to focusing the first cancel button (and where that button will be depends on if a header is supplied or not):

```javascript
it("should focus the close button when no focusable markup is passed and header is present", () => {
  const modal = createElement("c-modal", {
    is: Modal,
  });
  modal.modalHeader = "Some Value";
  document.body.appendChild(modal);

  modal.toggleModal();

  return assertForTestConditions(() => {
    const firstCloseButton = modal.shadowRoot.querySelector(
      'button[title="Close"]'
    );
    expect(firstCloseButton).toBeTruthy();
    expect(modal.shadowRoot.activeElement).toBeTruthy();

    expect(firstCloseButton).toEqual(modal.shadowRoot.activeElement);
  });
});

it("should focus the cancel button when no focusable markup is passed and no header is present", () => {
  const modal = createElement("c-modal", {
    is: Modal,
  });
  document.body.appendChild(modal);

  modal.toggleModal();

  return assertForTestConditions(() => {
    const firstCloseButton = modal.shadowRoot.querySelector("button");
    expect(firstCloseButton).toBeTruthy();
    expect(modal.shadowRoot.activeElement).toBeTruthy();

    expect(firstCloseButton).toEqual(modal.shadowRoot.activeElement);
  });
});
```

And there you have it. That's the extent of the logic that lives within the modal, tested!

## Wrapping Up Testing The LWC Modal

Again, I definitely didn't expect there to be such public interest in improving the modal. It was a really fun weekend collaborating with a variety of people on focus-trap improvements; I also was eager to outline some common test cases.

Hopefully the latest in the [Joys Of Apex](/) has proven to be helpful to you when considering how to create and test composable Lightning Web Components -- till next time!
