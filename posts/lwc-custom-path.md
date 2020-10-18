> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Lightning Web Components Custom Lead Path

> :Author src=github

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

The Path component that comes standard with Salesforce is a wonderful visualization tool for Sales when working on Leads / Opportunities, and it can be utilized to great effect with Cases in Service Cloud, too. The vanilla Path component has seen some customization options since its initial release, and you can wire up dropdown menus attached to it to deal with associated fields. That's a lot more customization than you typically get, out of the box — but what happens when you want more? What happens if you want to group related picklist fields together? What happens if you want to validate required fields without adding additional metadata (in the way of validation rules)? What happens if you want to hide some of the picklist statuses per record type?

In 2017, I had a problem. I was working on a Salesforce migration into Sales Cloud and stakeholders wanted to hide the vanilla "Convert Lead" popup that is surfaced through advancing the Lead path. There were a number of reasons behind the request (all reasonable), but we weren't particularly familiar with Aura — which was fairly new at the time — and our experiences with VisualForce had left us scarred. The stakeholders for Sales were pumped about the Lead path component; the team was dismayed that we might need to hide it to prevent improper lead conversions (which were being routed purely through Apex).

I wanted a fresh challenge and decided to build out a custom Lead path component over the weekend using Aura. I want to heavily preface this statement by saying that this was entirely of my own volition, and while I will always advocate for taking breaks, and the importance particularly of keeping the weekend purely to spend as you please, in this specific instance I was looking to learn something, and I knew my team wouldn't get to the request prior to launching otherwise. At the time, I knew only the basics of HTML, and I was just beginning to learn JavaScript on an old Angular (shudder) codebase. Throwing an entirely new framework into the mix meant for slow going that weekend, and even with the incredible headstart given by the use of the Aura Path component by [Appiphony](https://github.com/appiphony/Strike-Components), I barely finished after two 14+ hour days.

The Aura component — markup, JS controller, JS helper, Apex controller, and tests ended up contributing a little over 600 lines of code to our codebase. In looking at the advancements with the Lightning Data Service since I worked on that component, and now having a [composable modal](/lwc-composable-modal) to work with (a crucial pre-req), I wanted to see just how slim a Lightning Web Component version of the custom Path component would be.

---

## Path Overview

In the end, using LDS to load SObject data, as well as better asynchronous methods in LWC in general, helps to trim the LWC version of the Path to ~400 lines of code. Yes, it does rely on the modal component that we built previously, but the modal is also a reusable (and far more powerful/responsive) component than the one that shipped with the Aura component I built. This Path component:

- relies on both `Lead.Status` picklist values as well as the current Lead's Status. We'll get into why that's an interesting problem from an engineering standpoint in a bit
- follows the accessibility recommendations for Path implementers as documented in the Lightning Design System
- groups "Closed" Lead Statuses together; this shows how [the modal](/lwc-composable-modal) gets incorporated into more complicated components, as well as how you can use composable components to simplify the design and maintenance of your Salesforce frontend
- shows how to validate and display errors for required fields prior to submitting a form/group of input components

When using the Lightning Data Service (hereafter referred to as LDS, though this acronym can confusingly also apply to the Lightning Design System), `@wire` attributes are used to provisionally fetch data without a dedicated Apex controller backend. However, an interesting bullet point on this approach is that most of the examples using LDS to fetch data from the backend rely on at most _two_ sources; this is the case for the `getPicklistValues` function that we will be exhibiting shortly. `getPicklist` values shows how a function/property can pass required data by using the `$` sign at the beginning of a string to represent a _reactive local property_; in instances where parameters to LDS are supplied with the dollar sign at the start of their string, the function waits until _that_ data is loaded prior to getting its own data.

But what happens when you have a component that relies upon two independent streams of wired data? Such is the case when considering rebuilding the Lead Path component — you need the available picklist statuses per record type (for our example, we'll just be using the default record type, but you can easily expand the component that ends up being shown to accomodate specific record types), _and_ in order to show the Path at the current status, you need the current Lead status.

Savvy Path users will note that the vanilla Path component in Salesforce visibly loads and _then_ shows the current status. There's also a video I'll show later of this same issue. That brief flicker is something that we'll try to avoid in our custom component — and in order to do so, we'll have to dive in to the `@wire` attribute.

## Lightning Data Service Overview

Lightning Data Service, or LDS, differs from fetching data from within your Salesforce instance via an `@AuraEnabled` Apex controller in a few ways (as enumerated in the documentation):

> Record data is loaded progressively (non-blocking). Results are cached client-side automatically. The cache is automatically invalidated when the underlying data changes. Back-and-forths with the server are minimized by sharing the request cache amongst components; components using the same underlying data use only a single request.

The _shape_ of data that's used to update your underlying object representations also differs between LDS and your Apex controller. Consider the Lead object sent to the LDS `updateRecord` method:

```json
{
  //for `updateRecord`
  // "apiName" top-level field can be omitted
  "fields": {
    "Status": "Closed - Converted",
    "CustomDate__c": null,
    "Id": "someLeadId"
  }
}
```

This is a `RecordInput` type that can be fed directly to the LDS methods. Alternatively, you can use the `generateRecordInputForCreate` or `generateRecordInputForUpdate` helper methods to accomplish the same thing. Either way, your method call to perform the insert/update ends up being pretty simple:

```javascript
const recordToUpdate = {
  fields: {
    Id: this.recordId,
    //other fields
  },
};
await updateRecord(recordToUpdate);
```

This involves an additional level of nesting from the JSON as compared to a Lead that's being sent to an Apex controller:

```json
//this gets deserialized by your Apex controller as a lead
{
  "Status": "Closed - Converted",
  "CustomDate__c": null,
  "Id": "someLeadId"
}
```

On the other hand, you have to use a named parameter when sending data to an Apex controller, so it's not as simple as supplying your key/value JSON object to the method:

```javascript
import { LightningElement, wire } from "lwc";
import exampleApexMethod from "@salesforce/apex/SomeApexController.exampleApexMethod";

export default class ExampleComponent extends LightningElement {
  lead = {
    Id: this.recordId,
    //other values
  };

  //the "example" named parameter below
  //MUST match the name of the parameter on the Apex side
  @wire(exampleApexMethod, { example: "$lead" }) apexResponse;
}
```

In general, because LDS is available for Aura as well as LWC, it's always a good time to be migrating your components away from using Apex unless the data you're trying to retrieve isn't supported, or an update you're looking to perform would be complicated to perform using the LDS adapters. For one thing, it's surprising to me that the company that invented the word "bulkification" doesn't have bulk-ready LDS adapters; this isn't really applicable in today's example, but for enabling in-line edit in LWC's making use of `lightning-datatable`, having to iterate through and update the edited rows one-by-one isn't ideal.

There are still legitimate use-cases for Apex controllers with LWC — lots of them, in fact. If your data needs are simple, however, you should definitely be using LDS.

### Loading Multiple @Wire Methods With Dependent Data Using LDS

There are some obvious examples in the Salesforce documentation that show you how to load data dependent on another `@wire` method; for our purposes, again, we'll be using `getPicklistValues`, which typically depends on the `getObjectInfo` wire (although, embarrassingly, all of the shown examples in the `lwc-recipes` repo that make use of the `getPicklistValues` LDS method _hard-code the record type_).

The basic method signature for using `getPicklistValues` looks something like this in a LWC:

```javascript
import { getPicklistValues } from 'lightning/uiObjectInfoApi';
import STATUS_FIELD from '@salesforce/schema/Lead.Status';

export default class CustomPath extends LightningElement {
  @wire(getPicklistValues, {
    recordTypeId: '$your wired up record type Id here',
    fieldApiName: STATUS_FIELD
  }) //property or function here
}
```

So right away, we have this `$` character denoting that we're referring to a reactive property, but there's one crucial line in the docs necessary to bridge between the pre-requisite for using this function without hard-coding, and getting the data you need:

> You can use one `@wire` output as another `@wire` input. For example, you could use `$record.data.fieldName` as an input to another wire adapter.

Aha — so we can actually reference the underlying returned data from one `@wire` method when calling another `@wire` method:

```javascript
import { getObjectInfo } from "lightning/uiObjectInfoApi";
import { getPicklistValues } from "lightning/uiObjectInfoApi";

import LEAD_OBJECT from "@salesforce/schema/Lead";
import STATUS_FIELD from "@salesforce/schema/Lead.Status";

export default class CustomPath extends LightningElement {
  @wire(getObjectInfo, { objectApiName: LEAD_OBJECT })
  objectInfo;

  //here, we use the results of the `objectInfo` call
  @wire(getPicklistValues, {
    recordTypeId: "$objectInfo.data.defaultRecordTypeId",
    fieldApiName: STATUS_FIELD,
  })
  leadStatuses({ data, error }) {
    const leadStatusCb = (data) => {
      //logic for handling the data
    };
    this._handleWireCallback({ data, error, cb: leadStatusCb });
  }

  _handleWireCallback = ({ data, error, cb }) => {
    //in reality you'd want to gracefully handle/display
    //the error, but we're prototyping here!
    //either way, I like to have a method like this to consolidate
    //error handling when using multiple @wire methods
    if (error) console.error(error);
    else if (data) {
      cb(data);
    }
  };
}
```

That takes care of one hurdle — fetching the appropriate Lead Statuses by the default Record Type. But what about the problem I was outlining earlier? When we receive the Lead Statuses, we'll actually need to denote a lot of information about each status:

- where it is on the path
- is the status active (based on the Lead's current status)
- is the status currently selected? (this can differ from active because people can select a different status prior to saving)

### The Dirty Way To Call LWC @Wire Methods With Dependent Data

There _is_ one way that you can ensure that data is returned (in this case, the current Lead info when making the `getPicklistValues` call): by adding an extra reactive property to your LDS call that references a variable set by another `@wire` call:

```javascript
@wire(getPicklistValues, {
  recordTypeId: '$objectInfo.data.defaultRecordTypeId',
  fieldApiName: STATUS_FIELD,
  //this one dirty hack you would never expect ...
  //in all seriousness, I'm not certain what the "supported"
  //state is for passing extraneous values to @wire methods
  status: '$_status'
  //^^ here _status would be set by another @wire method
})
```

I started experimenting with this method before concluding that despite the niceties of the code about statuses living in one place, it was totally marred by the seemingly friable nature of this approach. While including additional paramaters in `@wire` methods doesn't throw an error at present, there's no guarantee that the way that the API handles such extra paramaters won't change in the future. Better to do things by the books.

### The Proper Way To Deal With Dependent @Wire Data

The _proper_ way to handle such dueling requirements is through the use of the `renderedCallback` lifecycle method. `renderedCallback` runs every time that a Lightning Web Component is re-rendered; because of this, logic that pertains only to the first "full" load of the component (when all data has been loaded) is typically gated behind a one-time conditional. On the `<template>` markup side of the equation, you'll also be using part of the same conditional to only display the full contents of the component once the data has been loaded:

```html
<template>
  <c-modal
    modal-header="Close Status Required"
    modal-tagline="Set the specific close status to proceed!"
    modal-save-handler="{modalSaveHandler}"
  >
    <template if:true="{hasData}">
      <!-- body of the component here — >
    </template>
  </c-modal>
</template>
```

And in the JavaScript controller:

```javascript
import { api, LightningElement, track, wire } from "lwc";
import { getObjectInfo } from "lightning/uiObjectInfoApi";
import { getPicklistValues } from "lightning/uiObjectInfoApi";
import { getRecord, updateRecord } from "lightning/uiRecordApi";
import { ShowToastEvent } from "lightning/platformShowToastEvent";

import LEAD_OBJECT from "@salesforce/schema/Lead";
import CUSTOM_DATE_FIELD from "@salesforce/schema/Lead.CustomDate__c";
import STATUS_FIELD from "@salesforce/schema/Lead.Status";

const COMPLETED = "Mark Status as Complete";
const CLOSED = "Closed";
const CLOSED_CTA = "Select Closed Status";
//more on this in a bit
const SPECIAL_STATUS = "Closed - Special Date";

export default class CustomPath extends LightningElement {
  //I like to keep all @wire/lifecycle
  //methods at the top of my components
  @api recordId;
  @wire(getObjectInfo, { objectApiName: LEAD_OBJECT })
  objectInfo;

  @wire(getRecord, {
    recordId: "$recordId",
    fields: [CUSTOM_DATE_FIELD, STATUS_FIELD],
  })
  lead({ data, error }) {
    const leadCb = (data) => {
      this.status = this._getLeadValueOrDefault(
        data,
        STATUS_FIELD.fieldApiName
      );
      this.storedStatus = this.status;
      this.dateValue = this._getLeadValueOrDefault(
        data,
        CUSTOM_DATE_FIELD.fieldApiName
      );
      if (this.status && this.status.includes(CLOSED)) {
        this.advanceButtonText = CLOSED_CTA;
        this.currentClosedStatus = this.status;
        this.customCloseDateSelected =
          this.currentClosedStatus === SPECIAL_STATUS;
      }
    };

    this._handleWireCallback({ data, error, cb: leadCb });
  }

  @wire(getPicklistValues, {
    recordTypeId: "$objectInfo.data.defaultRecordTypeId",
    fieldApiName: STATUS_FIELD,
  })
  leadStatuses({ data, error }) {
    const leadStatusCb = (data) => {
      const statusList = [];
      data.values.forEach((picklistStatus) => {
        if (!picklistStatus.label.includes(CLOSED)) {
          statusList.push(picklistStatus.label);
        }
      });
      //the order matters here and isn't obvious
      //but we want "Closed" to be the LAST status
      statusList.push("Closed");
      this._statuses = statusList;

      //now build the visible/closed statuses
      data.values.forEach((status) => {
        if (status.label.includes(CLOSED)) {
          //we're using a combobox in markup
          //which requires both label/value
          this.closedStatuses.push({
            label: status.label,
            value: status.label,
          });
          if (!this.currentClosedStatus) {
            //promote the first closed value to the component
            //so that the combobox can show a sensible default
            this.currentClosedStatus = status.label;
          }
        } else {
          this.visibleStatuses.push(this._getPathItemFromStatus(status.label));
        }
      });
      this.visibleStatuses.push(this._getPathItemFromStatus(CLOSED));
    };
    this._handleWireCallback({ data, error, cb: leadStatusCb });
  }

  renderedCallback() {
    if (!this._hasRendered && this.hasData) {
      //prevents the advance button from jumping to the side
      //as the rest of the component loads
      this.showAdvanceButton = true;
      this._hasRendered = true;
    }
    if (this.hasData) {
      //everytime the component re-renders
      //we need to ensure the correct CSS classes
      //and accessibility attributes are applied
      const current = this.visibleStatuses.find((status) =>
        this.storedStatus.includes(status.label)
      ) || { label: "Unknown" };
      current.ariaSelected = true;
      current.class = "slds-path__item slds-is-current slds-is-active";

      const currentIndex = this.visibleStatuses.indexOf(current);
      this.visibleStatuses.forEach((status, index) => {
        if (index < currentIndex) {
          status.class = status.class.replace(
            "slds-is-incomplete",
            "slds-is-complete"
          );
        }
      });
    }
  }

  /* private fields for tracking */
  @track advanceButtonText = MARK_COMPLETED;
  @track closedStatuses = [];
  @track currentClosedStatus;
  @track customCloseDateSelected = false;
  @track dateValue;
  @track status;
  @track storedStatus;
  @track visibleStatuses = [];

  //truly private fields
  _hasRendered = false;
  _statuses;

  get hasData() {
    return !!(this.storedStatus && this.visibleStatuses.length > 0);
  }

  //truly private methods, only called from within this file
  _handleWireCallback = ({ data, error, cb }) => {
    if (error) console.error(error);
    else if (data) {
      cb(data);
    }
  };

  _getPathItemFromStatus(status) {
    const ariaSelected = !!this.storedStatus
      ? this.storedStatus.includes(status)
      : false;
    const isCurrent = !!this.status ? this.status.includes(status) : false;
    const classList = ["slds-path__item"];
    if (ariaSelected) {
      classList.push("slds-is-active");
    } else {
      //we'll end up fixing this in rendered callback
      classList.push("slds-is-incomplete");
    }
    if (isCurrent) {
      classList.push("slds-is-current");
    }
    return {
      //same here
      ariaSelected: false,
      class: classList.join(" "),
      label: status,
    };
  }

  _getLeadValueOrDefault(data, val) {
    return data ? data.fields[val].displayValue : "";
  }

  _updateVisibleStatuses() {
    //update the shown statuses based on the selection
    const newStatuses = [];
    for (let index = 0; index < this.visibleStatuses.length; index++) {
      const status = this.visibleStatuses[index];
      const pathItem = this._getPathItemFromStatus(status.label);
      if (this.status !== this.storedStatus || pathItem.label !== this.status) {
        pathItem.class = pathItem.class
          .replace("slds-is-complete", "")
          .replace("  ", " ");
      }
      newStatuses.push(pathItem);
    }
    this.visibleStatuses = newStatuses;
  }
}
```

That's nearly _all_ of the JavaScript required to get the appropriate Path data showing on the page. The only thing that's missing from the controller that's shown are the reactive handlers — for listening to click events, as well as how to handle what goes on in the modal. Before we return to that (much easier) territory, let's conclude the dependent `@wire` section by saying that though the use of the component's lifecycle methods to completely prepare the appropriate Lead Statuses and properties means that the code is not as terse as it could be, it remains the idiomatic way to massage independent streams of data in your components into the format required by your markup.

## Returning To The Custom Path

The interesting thing about the markup is that it all gets slotted into the existing modal. If there were additional chances for code re-use in this component, they would likely come from the `<li>` elements present within the Path. You could definitely work on generalizing the Path itself; because for this example I wanted to show how to group "Closed" statuses together, the logic ends up being fairly coupled to the underlying Path markup. Certainly this could be generalized to accept an `SObject` type and a picklist field to accomplish the same thing with greater re-use for all picklist fields with "Closed" values — alternatively, stripping out the grouping section would bring you to a fully re-usable Path component that could be used and customized for any picklist field.

I'm also using a `CustomDate__c` field (included in the linked repository) to show what entering a date required to save a Lead in a certain "Closed" status would look like:

```html
<template>
  <c-modal
    modal-header="Close Status Required"
    modal-tagline="Set the specific close status to proceed!"
    modal-save-handler="{modalSaveHandler}"
  >
    <template if:true="{hasData}">
      <article class="slds-card" slot="body">
        <div class="slds-card__body slds-card__body_inner">
          <div class="slds-path">
            <div class="slds-grid slds-path__track">
              <div class="slds-grid slds-path__scroller-container">
                <div
                  class="slds-path__scroller"
                  tabindex="-1"
                  role="application"
                >
                  <div class="slds-path__scroller_inner">
                    <ul
                      class="slds-path__nav"
                      role="listbox"
                      aria-orientation="horizontal"
                    >
                      <template for:each="{visibleStatuses}" for:item="stage">
                        <li
                          class="{stage.class}"
                          role="presentation"
                          key="{stage.label}"
                          onclick="{handleStatusClick}"
                        >
                          <a
                            class="slds-path__link"
                            tabindex="-1"
                            role="option"
                            title="{stage.label}"
                            aria-selected="{stage.ariaSelected}"
                          >
                            <span class="slds-path__stage">
                              <lightning-icon
                                variant="bare"
                                class="slds-button__icon"
                                icon-name="utility:check"
                                size="x-small"
                                alternative-text="{stage}"
                              ></lightning-icon>
                            </span>
                            <span class="slds-path__title">{stage.label}</span>
                          </a>
                        </li>
                      </template>
                    </ul>
                  </div>
                </div>
                <template if:true="{showAdvanceButton}">
                  <div class="slds-grid slds-path__action">
                    <lightning-button
                      class="slds-path__mark-complete slds-no-flex slds-m-horizontal__medium"
                      variant="brand"
                      icon-name="{pathActionIconName}"
                      onclick="{handleAdvanceButtonClick}"
                      title="{advanceButtonText}"
                      label="{advanceButtonText}"
                    >
                    </lightning-button>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </article>
      <div slot="modalContent">
        <template if:true="{showClosedOptions}">
          <lightning-combobox
            class="slds-m-around_small slds-form-element"
            name="status"
            label="Status"
            value="{currentClosedStatus}"
            placeholder="Select Closed Status"
            options="{closedStatuses}"
            onchange="{handleClosedStatusChange}"
            required
            message-when-value-missing="Please select a closed status"
          ></lightning-combobox>
          <template if:true="{customCloseDateSelected}">
            <p>
              The date you use below will cause the lead to reopen in the
              future. Assignment rules will be rerun at the time; if you are
              still the owner, you will be notified, otherwise the new owner
              will be.
            </p>
            <lightning-input
              class="slds-form-element slds-m-around_small"
              label="Reopen Date"
              type="date"
              date-style="short"
              value="{dateValue}"
              onchange="{handleDateOnChange}"
              required
            >
            </lightning-input>
            <p>Once you're done selecting the date, click "Save" to proceed!</p>
          </template>
        </template>
      </div>
    </template>
    <template if:false="{hasData}">
      <lightning-spinner
        alternative-text="Loading"
        size="small"
      ></lightning-spinner>
    </template>
  </c-modal>
</template>
```

Of the things in the JavaScript LWC controller that we haven't explored but are referenced in the markup:

```javascript
modalSaveHandler = async (event) => {
  event.stopPropagation();
  event.preventDefault();

  //one of the nicer code snippets shown
  //in the LWC docs - display an error on any
  //field marked required but improperly filled out
  const allValid = [
    ...this.template.querySelectorAll('.slds-form-element')
  ].reduce((validSoFar, formElement) => {
    formElement.reportValidity();
    return validSoFar && formElement.checkValidity();
  });
  if (allValid) {
    this._toggleModal();
    await this._saveLeadAndToast();
  }
};

handleStatusClick(event) {
  event.stopPropagation();
  //update the stored status, but don't update the record
  //till the save button is clicked
  const updatedStatusName = event.target.textContent;
  this.advanceButtonText =
    updatedStatusName === this.status ? COMPLETED : 'Mark As Current Status';
  this.storedStatus = updatedStatusName;

  if (this.status !== this.storedStatus) {
    this._updateVisibleStatuses();
  }

  if (this.storedStatus === CLOSED) {
    this._advanceToClosedStatus();
  }
}

handleClosedStatusChange(event) {
  const newClosedStatus = event.target.value;
  this.currentClosedStatus = newClosedStatus;
  this.storedStatus = newClosedStatus;
  this.customCloseDateSelected = this.storedStatus === SPECIAL_STATUS;
}

handleDateOnChange(event) {
  this.dateValue = event.target.value;
}

async handleAdvanceButtonClick(event) {
  event.stopPropagation();

  if (
    this.status === this.storedStatus &&
    !this.storedStatus.includes(CLOSED)
  ) {
    const nextStatusIndex =
      this.visibleStatuses.findIndex(
        (visibleStatus) => visibleStatus.label === this.status
      ) + 1;
    this.storedStatus = this.visibleStatuses[nextStatusIndex].label;
    if (nextStatusIndex === this.visibleStatuses.length - 1) {
      //the last status should always be "Closed"
      //and the modal should be popped
      this._advanceToClosedStatus();
    } else {
      await this._saveLeadAndToast();
    }
  } else if (this.storedStatus.includes(CLOSED)) {
    //curses! they closed the modal
    //let's re-open it
    this._advanceToClosedStatus();
  } else {
    await this._saveLeadAndToast();
  }
}

//truly private methods, only called from within this file
_advanceToClosedStatus() {
  this.advanceButtonText = CLOSED_CTA;
  this.storedStatus = this.currentClosedStatus;
  this.showClosedOptions = true;
  this._toggleModal();
}

_toggleModal() {
  this.template.querySelector('c-modal').toggleModal();
}

async _saveLeadAndToast() {
  let error;
  try {
    this.status = this.storedStatus;
    const recordToUpdate = {
      fields: {
        Id: this.recordId,
        Status: this.status,
        CustomDate__c: null
      }
    };
    if (this.dateValue && this.status === SPECIAL_STATUS) {
      recordToUpdate.fields.CustomDate__c = this.dateValue;
    }
    await updateRecord(recordToUpdate);
    this._updateVisibleStatuses();
    this.advanceButtonText = MARK_COMPLETED;
  } catch (err) {
    error = err;
    console.error(err);
  }
  //not crazy about this ternary
  //but I'm even less crazy about the 6
  //extra lines that would be necessary for
  //a second object
  this.dispatchEvent(
    new ShowToastEvent({
      title: !error ? 'Success!' : 'Record failed to save',
      variant: !error ? 'success' : 'error',
      message: !error
        ? 'Record successfully updated!'
        : `Record failed to save with message: ${JSON.stringify(error)}`
    })
  );
  //in reality, LDS errors are a lot uglier and should be handled gracefully
  //I recommend the `reduceErrors` utils function from @tsalb/lwc-utils:
  //https://github.com/tsalb/lwc-utils/blob/master/force-app/main/default/lwc/utils/utils.js
}
```

So ... ~100 lines (including comments) of code to handle all listeners (and there are a lot of clickable elements in a Path component!), most of which are either simply reflecting event-level data to an underyling, `@track`'d property, _or_ deal with saving the record / closing the modal. Maybe that seems like a lot. In practice, I consider the use of LDS (when appropriate / possible) beneficial since you're saving on the concomitant lines of code that would be dedicated to your Apex Controller and test class.

## What Does The Custom Path LWC End Up Looking Like?

OK, OK — what does it look like, at the end of the day? First of all, you can see that [on render speed alone the custom Path component outperforms the vanilla Path component](https://res.cloudinary.com/she-and-jim/video/upload/v1592765674/joys-of-apex-example-path.mp4). There's a noticeable flicker on the vanilla Path prior to the current status being shown.

Here's what the Path looks like in the background with the modal open after having selected a "Closed" status:

![Showing the non-expanded modal state](/img/lwc-example-custom-lead-path-closed-not-expanded.png)

And then with the custom "Special Date" closed status selected (notice I'm using the vanilla component in the background to compare to 😅):

![The expanded modal state](/img/lwc-example-custom-lead-path-closed-expanded.png)

Lastly, what it looks like mid-Path:

![The Path by itself](/img/lwc-example-custom-lead-path-without-modal.png)

## Conclusion

I'm sure that there are still edge-cases to consider when it comes to creating a custom Path component. This exercise, unlike [the modal](/lwc-composable-modal), doesn't cover everything — for example, on the Lead Flexipage, if you wanted to use this custom Path component but didn't have a Lightning Button / Quick Action or other drop-in alternative for lead conversion, the Path as stands still would need work.

If you'd like to see the code for the custom Path component, [I've pushed it to a branch here](https://github.com/jamessimone/apex-mocks-stress-test/tree/lwc-path).

Despite this, I hope it's been helpful to see how using building blocks like the composable modal can increase your iteration speed and ability to implement complex features by encapsulating complexity in each Lightning Web Component. Thanks for following along — till next time!

The original version of [Lightning Web Components: Custom Path can be read on my blog.](https://www.jamessimone.net/blog/joys-of-apex/lwc-custom-path/)
