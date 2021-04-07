> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Advanced Logging Using Nebula Logger

> :Author src=github,date=2021-03-08T15:12:03.284Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

_Today's post is a guest post by [Jonathan Gillespie](https://www.linkedin.com/in/jongpie/) -- a good friend of mine, and our first guest author! I'm really excited to have him here to talk about [Nebula Logger](https://github.com/jongpie/NebulaLogger). While it's a project that I've contributed to, it's Jonathan's brain child, and there's nobody more qualified when it comes to the subject of logging within the Salesforce platform. I'll include a little more on our shared story [in the postscript](#postscript) -- enjoy!_

**Jonathan**: I've enjoyed working with the Salesforce platform for nearly a decade - over this time Salesforce has implemented countless new features that have really improved the platform both for Salesforce implementation experts (admins, developers, architects and more) as well as for Salesforce users. But we all know that no system is without issue - every system has bugs, every project has missed requirements & scenarios, and we need to be able to easily answer some questions about our Salesforce orgs:
 * What's happening in my Salesforce orgs?
 * Are we experiencing any errors?
 * In what environment did the error happen?
 * Who was the logged-in user?
 * What record was being created/updated when it happened?
 * Are we being proactive about fixing the issue?
 * Did our scheduled batch job finish?

Despite Salesforce's releases over the years, I still find myself struggling to answer some of these questions using only features provided out of the box. The inspiration for what would become Nebula Logger was born. But first...

## What Logging Does Salesforce Provide
Salesforce does [provide some basic logging functionality](https://trailhead.salesforce.com/en/content/learn/modules/developer_console/developer_console_logs) out-of-the-box for both Apex and Flow. However, it has some major limitations
 * You must enable logs for each user 🡪 limit of 24 hours max
 * Debug logs can be truncated
 * Salesforce auto-purges old logs
 * Each debug log must be 20 MB or smaller
 * System debug logs are retained for 24 hours. Debug logs are retained for 7days.
 * In Flow, admins/devs cannot add any equivalent to a 'debug statement' to help with their troubleshooting
 * Reporting & monitoring of logs is very limited. Paid add-ons (like Salesforce Shield) or 3rd party tools are typically needed for more details reporting & monitoring.

These limits can make it difficult to rely on Salesforce's logging to troubleshoot issues, especially if it's an inconsistent issue, or the user does not know how to recreate the issue.

## Introducing Nebula Logger
Several years ago, I found myself struggling with some of these major limitations of the logging & debug tools provided by Salesforce. I explored other options on AppExchange and elsewhere, but ultimately decided to just start working on my own project - Nebula Logger. It's an open source project that I've tinkered with for years (along with the help of none other than James Simone himself) to try to solve several logging challenges when working with the Salesforce platform.

Nebula Logger is an ever-evolving attempt at building a logging tool that helps to answer these questions (and more) for Salesforce implementations. The current version of Nebula Logger, v4.0.0, has 10 core features designed to work natively on the Salesforce platform (available as a managed package and unpackage code)

![Nebula Logger Overview](./img/nebula-logger-architecture.png)

## Feature #1: Use Salesforce Features to Manage Logs
When I first started working on Nebula Logger, I had already been implementing Salesforce for a few years - and I was frustrated not only that Salesforce's logging was limited, but also by the fact that Salesforce provides so much functionality for other projects, but I couldn't use it (natively) to manage logs. I set out to create a logging tool that would let me leverage Salesforce itself to manage logs, and quickly realized that "simply" storing data in custom objects would open up the possibilities of using several features, including
 * Create Salesforce reports & dashboards for monitoring logs
 * Leverage list views and App Builder for navigating & viewing logs
 * Assign important logs to users & queues
 * Use Chatter for collaborating on logs

This gave me the first custom object & project goal: use a `LogEntry__c` custom object to store log data.

![LogEntry__c custom object](./img/data-model-logentry.png)

## Feature #2: Log AND Throw Exceptions
One of the most basic (if not the most critical) reasons that you might want to log something in any system: an error occurred, and we want to know about it. Seems pretty basic, but for years, you could not (easily) accomplish this within Salesforce.
 * **Prior to the Summer '17 release**: there was a major architectural limitation that made a true custom logging system nearly impossible - any error in Salesforce (declarative errors, throwing Apex exceptions, etc.) would cause all DML statements in the current transaction to roll back. This meant that you couldn't log an error AND throw an exception. There were a few ways to work around this limitation, but none of them were ideal and did not work in all situations.

    ```java
    try {
        update someRecord;
    } catch(Exception apexException) {
        // Simple example of catching an error & trying to log it
        // before Platform Events (using a custom object)
        insert new LogEntry__c(
            ErrorMessage__c = apexException.getMessage()
        );

        // After inserting  a log entry (or any SObject record)...
        //... throwing this exception would still automatically rollback the insert operation
        throw apexException;
    }
    ```

 * **Spring '17 - Platform Events** - But in Spring '17, Salesforce [released Platform Events](https://help.salesforce.com/articleView?id=release-notes.rn_api_messaging.htm&type=5&release=208), a new type of object that uses event-driven architecture to publish & subscribe to certain 'events' within the system. In my opinion, this is when a true logging system finally became feasible; using Platform Events, we can now create event records that are always generated, even if an exception occurs.

    ```java
    try {
        update someRecord;
    } catch(Exception apexException) {
        // Using Platform Events & the EventBus class, we can publish events even if an exception is thrown
        EventBus.publish(new LogEntryEvent__e(
            ErrorMessage__c = apexException.getMessage()
        ));

        // Publishing a log entry event (or any Platform Event that uses the 'Publish Immediately' behavior)
        //... will still occur, even if an exception is thrown after the EventBus is called
        throw apexException;
    }
    ```

Platform Events are now the go-to option for handling logging in Salesforce - Nebula Logger uses a platform event object called `LogEntryEvent__e` to ensure that log entries are published, even if an error occurs.

![LogEntryEvent__e and LogEntry__c](./img/data-model-logentryevent-and-logentry.png)

**Note from James** -- because for so many years it was impossible to achieve true logging within Salesforce since exceptions couldn't be logged to a custom object, and because many companies use a variety of applications in addition to Salesforce, it's still not unheard of to export Salesforce error logs to a centralized database for logging exceptions (be it some localized Kibana stack, or a 3rd party solution like Rollbar). You can find more info about these approaches in the [Apex Logging Service](/apex-logging-service) article. Perhaps I'll have to twist Jonathan's arm into supporting also sending the contents of logs to an external system as part of Nebula 😇!

## Feature #3: Unified Log with a Unique Transaction ID
Not only do we want to log data, but we want to see all related log entries together - any entries created during the same transaction should be related together. To accomplish this, we need a unique ID for the transaction so we can relate multiple 'log entries' to a single 'log' record for a unified logging record. This sounds like another feature that *should* be easy, but until recently, it was another major gap in the platform.
 * **Prior to Winter '21**: no king of transaction ID was provided. Presumably, Salesforce had a way to internally see a transaction ID, but there was no way for us to see or leverage it in Apex or Flow. Prior to Winter '21, my best solution was not an easy solution - I (tried to) port [the UUID v4](https://en.wikipedia.org/wiki/Universally_unique_identifier) standard [to Apex](https://github.com/jongpie/ApexUuid/) just so I could easily create a unique ID during an Apex transaction (Apex still lacks the native ability to create a UUID/GUID).
 * **Winter '21 - Quiddity**: In the [Winter '21 release](https://help.salesforce.com/articleView?id=release-notes.rn_apex_Runtime_Detection.htm&type=5&release=228), Salesforce finally added a way in Apex to see a unique transaction ID, as well as other details about the current transaction, such as the request type (available through [the Request class](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_class_System_Request.htm)). Nebula Logger now uses Salesforce's provided Request ID as the `Log__c` records unique ID (implemented by James Simone!). More details about detecting the Apex runtime are [available in Salesforce Help](https://help.salesforce.com/articleView?id=release-notes.rn_apex_Runtime_Detection.htm&type=5&release=228).


Retrieving the unique transaction ID can now be accomplished with 1 line of code.
```java
String uniqueTransactionId = System.Request.getCurrent().getRequestId();
```

With a unique ID (and external ID fields), we can expand the data model so related log entries are tied to a single log record.

![LogEntryEvent__e, Log__c and LogEntry__c](./img/data-model-logentryevent-log-and-logentry.png)

## Feature #4: Support All of Salesforce's Logging Levels
Ideally, we want to always track and know everything about our system. Realistically, logging adds overhead, and some log entries are more important than others
 * More logging == more data storage is used
 * More logging == more CPU time, DML statements (and other platform limits) is used

Although the specific levels aren't consistent between each language, most modern programming languages and logging tools support different logging levels. In Apex (and Nebula Logger), there are 7 supported logging levels.
```java
System.debug(LoggingLevel.ERROR, 'example ERROR message');
System.debug(LoggingLevel.WARN, 'example WARN message');
System.debug(LoggingLevel.INFO, 'example INFO message');
System.debug(LoggingLevel.DEBUG, 'example DEBUG message');
System.debug(LoggingLevel.FINE, 'example FINE message');
System.debug(LoggingLevel.FINER, 'example FINER message');
System.debug(LoggingLevel.FINEST, 'example FINEST message');
```

I've tried various method signatures over the years for providing a way to control a log entry's level, and ultimately, level-specific methods (with several overloads) has been the most popular approach. This provides a simple way to assign importance to each log entry, based on the selected logging level method.

```java
Logger.error('Add log entry using Nebula Logger with logging level == ERROR');
Logger.warn('Add log entry using Nebula Logger with logging level == WARN');
Logger.info('Add log entry using Nebula Logger with logging level == INFO');
Logger.debug('Add log entry using Nebula Logger with logging level == DEBUG');
Logger.fine('Add log entry using Nebula Logger with logging level == FINE');
Logger.finer('Add log entry using Nebula Logger with logging level == FINER');
Logger.finest('Add log entry using Nebula Logger with logging level == FINEST');
Logger.saveLog();
```

Every project is different, so every Salesforce team will need to decide on what logging levels to use for their org's implementation. But my general guideline is:
 * Not everything you log should *always* be logged - use levels `ERROR`, `WARN` or `INFO` for the truly important info.
 * For less critical entries (but entries that may still provide useful info in certain situations), I use `DEBUG`, `FINE`, `FINER` or `FINEST` logging levels.

Using the custom hierarchy setting `LoggerSettings__c`, you can then control which log entries are generated & saved at 3 levels: the org (i.e., the default behavior for the environment), a profile, or user. This is useful for easily scaling your logging needs. For example, if you're deploying a new feature in your org for a particular team/department, you can update the logging levels for the team (either using profile or user-level settings) to enable more granular logging. This is a great way to help monitor production orgs; once you feel confident that everything is working as expected, you can then reduce the logging level to only include more important logging levels.

![Logger Settings](./img/logger-settings.png)

## Feature #5: Be Able to Log Code and Declarative Automations
Although some older automations, like Workflow rules, are still in use, Salesforce is focused on Flow for declarative automations and Apex for backend coding - Nebula Logger supports adding log entries for both Apex and Flows (as well as Process Builder, since it shares some of Flow's capabilities).
 * **Apex developers**: log everything using the `Logger` class
 * **Flow builders (and process builder)**: add log entries & record-specific log entries using one of the invocable methods in `FlowLogEntry` and `FlowRecordLogEntry` classes

My plan (insert safe harbor statement here) is to eventually add logging for Lightning Web & Aura components.

## Feature #6: Relate Log Entries to Any Record
When logging data, you may (frequently) want to log what particular `SObject` record is being created/updated/processed - this could be any standard or custom object, so a Salesforce logging tool should be able to handle any `SObject` type.

Salesforce *does* have a feature for this type of functionality - polymorphic lookup fields, available on objects like `Task` and objects with an `OwnerId` field
 * `Task.WhoId` can be either a Lead ID or a Contact ID.
 * `Task.WhatId` can be one of several standard objects, or any custom object with activities enabled.
 * Most `OwnerId` fields - like `Lead.OwnerId`, `Case.OwnerId`, `MyExampleObject__c.OwnerId` - are polymorphic fields - if you enable queues for the object, then the `OwnerId` field can be a user ID or a queue (group) ID.

Just one problem: we can't create custom polymorphic fields. This has been [an idea on Salesforce's Idea site since 2012](https://trailblazer.salesforce.com/ideaView?id=08730000000BqzBAAS), and the status is still "Not Planned", so it doesn't seem like this will be add natively any time soon. But using external IDs, formula fields and Apex code, Nebula Logger can simulate polymorphic fields in a scalable way that works with any SObject. It also provides several overloaded methods where you can pass an `Id recordId` or `SObject record` as parameters.

```java
Account account = [SELECT Id, Name, AccountNumber, RecordTypeId, RecordType.Name FROM Account LIMIT 1];
Logger.info('Example of logging an SObject record', account);
Logger.fine('Example of logging a record ID', account.Id);
Logger.saveLog();
```

Even if you log multiple SObject types, Nebula Logger will automatically track the SObject Type, record name and more.

![Log Entries with Related Record](./img/log-entry-related-records.png)

## Feature #7: Advanced Transaction Controls for Apex Developers
On many of my projects, I typically add logging into my project's trigger framework. This usually involves adding log entries that log details about the current trigger's SObject, and auto-saving at the end of each trigger. This helps tremendously with logging day-to-day operations when a user is simply updating a single record through the UI. But for more complex operations (such as batch jobs, data imports, etc.), the operations can be negatively impacted by the logging tool.

To help in these situations, Apex developers can use additional `Logger` methods to dynamically control how logs are saved during the current transaction.
 * `Logger.suspendSaving()` – causes Logger to ignore any calls to `saveLog()` in the current transaction until `resumeSaving()` is called. Useful for reducing DML statements used by Logger
 * `Logger.resumeSaving()` – re-enables saving after `suspendSaving()` is used
 * `Logger.flushBuffer()` – discards any unsaved log entries
 * `Logger.setSaveMethod(SaveMethod saveMethod)` - this method lets developers controls **how** log entries are saved.
   * `Logger.SaveMethod.EVENT_BUS` - The default save method, this uses the `EventBus` class to publish `LogEntryEvent__e` records.
   * `Logger.SaveMethod.QUEUEABLE` - This save method will trigger `Logger` to save any pending records asynchronously using a queueable job. This is useful when you need to defer some CPU usage and other limits consumed by `Logger`.
   * `Logger.SaveMethod.REST` - This save method will use the current user's session ID to make a synchronous callout to the org's REST API. This is useful when you have other callouts being made and you need to avoid mixed DML operations.

## Feature #8: Automatically Log Details About the Org, User and Record
Ideally, a logging tool should be easy to use, but provide a wealth of information. Nebula Logger automatically sets additional fields for all Apex and Flow logs
 * `Log__c` - Automatically stores details about the org, user, session and experience site (when applicable)

  ![Log Record Fields](./img/log-record-fields.png)

 * `LogEntry__c` - Automatically stores details about the related record (including the record's JSON), as well as details about all platform limits at the time that the log entry was generated.

  ![Log Entry Record Fields](./img/log-entry-record-fields.png)

## Feature #9: Track Related Logs for Async Processes (like Apex batchable and queueable jobs)
In Salesforce, asynchronous jobs like batchable and queuable run in separate transactions - each with their own unique transaction ID. To relate these jobs back to the original log, Apex developers can use the method `Logger.setParentLogTransactionId(String)`. Nebula Logger uses this value to relate child `Log__c` records, using the field `Log__c.ParentLog__c`

This sample batchable class shows how you can leverage this feature to relate all of your batch job's logs together.

```java
public with sharing class MyExampleBatchJob implements Database.Batchable<SObject>, Database.Stateful {
    private String originalTransactionId;

    public Database.QueryLocator start(Database.BatchableContext batchableContext) {
        // Each batchable method runs in a separate transaction
        // ...so store the first transaction ID to later relate the other transactions
        this.originalTransactionId = Logger.getTransactionId();

        Logger.info('Starting MyExampleBatchJob');
        Logger.saveLog();

        // Just as an example, query all accounts
        return Database.getQueryLocator([SELECT Id, Name, RecordTypeId FROM Account]);
    }

    public void execute(Database.BatchableContext batchableContext, List<Account> scope) {
        // One-time call (per transaction) to set the parent log
        Logger.setParentLogTransactionId(this.originalTransactionId);

        for (Account account : scope) {
            // TODO add your batch job's logic

            // Then log the result
            Logger.info('Processed an account record', account);
        }

        Logger.saveLog();
    }

    public void finish(Database.BatchableContext batchableContext) {
        // The finish method runs in yet-another transaction, so set the parent log again
        Logger.setParentLogTransactionId(this.originalTransactionId);

        Logger.info('Finishing running MyExampleBatchJob');
        Logger.saveLog();
    }
}

```

## Feature #10: Automatically Cleanup Old Logs
Since our custom objects `Log__c` and `LogEntry__c` use our org's data storage, we need to be able to easily delete old logs that are no longer relevant.

Nebula Logger provides two Apex classes out-of-the-box to handle automatically deleting old logs
1. `LogBatchPurger` - this batch Apex class will delete any `Log__c` records with `Log__c.LogRetentionDate__c <= System.today()`.
2. `LogBatchPurgeScheduler` - this schedulable Apex class can be schedule to run `LogBatchPurger` on a daily or weekly basis

## Nebula Logger Wrap-Up
After years of working on it, Nebula Logger is finally in a stable state - you can use the unpackaged code or managed package, both are completely free and [available on Github](https://github.com/jongpie/NebulaLogger). There are still several enhancements planned (and I'm sure there are still some bugs lurking), but I hope that admins, developers & architects find it to be a useful addition to their Salesforce implementations.

If you have any requested enhancements or bugfixes, feel free to open an issue in Github! Many thanks to everyone that has provided feedback over the last few years, and thanks to [James Simone](/) for the opportunity to publish on the [Joys of Apex](/).

The original version of [Advanced Logging Using Nebula Logger can be read on my blog](https://www.jamessimone.net/blog/joys-of-apex/advanced-logging-using-nebula-logger/) - it is mirrored here for your enjoyment!

---

<div id="postscript"/>

## Postscript

**James**: a big thanks, again, to Jonathan for agreeing to appear here on the Joys Of Apex. It will be fun to welcome more guest authors to host their content here in the future, but there was no better person to kick off our guest post series than him. Here's why:

2014 was a wild year, and the course of my life changed irrevocably -- and it all started with one meeting. Jonathan and I met pretty much exactly 7 years ago to this day. He was the latest in a slew of tech hires that most people met and then never saw again; our company had an unfortunate gap between the members of the technical team and the rest of the business, and there were already several developers working for this relatively small company whom I had only seen while meeting them. I was working in finance back then (itself a team of two; myself and the CTO), and I had an upcoming presentation not just for the president of my division, but also with the CEO of the entire company.

I had my doubts about walking yet another new hire who didn't care about the meat of the business through my responsibilities (distracted as I was with my upcoming presentation), but the hour-long meeting I had with Jonathan ran over time as he asked question after question. When I saw him again, nearly a month later, he presented me with a document -- pages and pages about my job, how it related to the overall business, and how our upcoming move to Salesforce could benefit me personally. To say that I was impressed would be an understatement.

Little did I know that within the next few months, the career in finance that I thought I wanted would be derailed permanently; that I would soon be installed as the product owner on the new tech team that Jonathan was a part of; that a few months after that he'd be giving me workbooks on Apex and SOQL. The thought process at that time was that because I was already proficient in SQL, I could pitch in on some smaller development asks to support Jonathan in his own role. He began teaching me how to write code, and stuck with me even though I was a slow learner.

The rest of the story -- and it's a fairly wild one by almost any standard -- is less about programming as it is about the exigencies of life and how the friends we meet along the way make the journey worth it. It's the story of how disasters can occur on even the best projects, and how we recover from those things. Is there space for such a tale here? Let me know -- for now, thanks for reading and I hope that you will consider [Nebula Logger](https://github.com/jongpie/NebulaLogger) for your on-platform logging needs!