> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Building An Apex Logging Service

> :Author src=github, date=2020-01-02T15:12:03.284Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

Welcome back to another Joys Of Apex session. We're going to take a quick break from the [TDD framework](/dependency-injection-factory-pattern) that I have been writing about to cover an interesting topic that came up on [r/salesforce](https://www.reddit.com/r/salesforce/comments/ei84u9/any_tools_or_apps_to_move_debug_logs_to_external/):

> We are about to launch a high traffic public site and want to enable debug logs continuously for some time(at least a month) but salesforce doesn't allow enabling debug log for more than 24 hours and also there is limit on how many debug logs it can store. Are there any tools or apps so that we can keep getting debug logs without having to worry about extending debug log and moving debug logs?

Having already co-authored a service that got around this issue by polling Salesforce periodically and extracting the debug logs to send on to an ELK instance, I became intrigued -- was it possible to accomplish the gathering of log bodies from within Salesforce itself, if the `ApexLog` object wasn't available to be queried from within SOQL?

### Bring out your logs

The adventure began. You can query the `ApexLog` SObject from within SOQL, but you can't access the _log body_ there -- so I wrote a little Tooling API wrapper to query for the logs. Those familiar with REST services in Apex know that we must needs depart from our TDD mindset in order to do some of these things, since you aren't allowed to make REST requests from within tests. Bummer. Since my usual approach is blocked off, we'll switch to everybody's favorite secondary approach -- debugging and praying!

```java | classes/ToolingApi.cls
public class ToolingApi {
    //in a real environment, I would store the API version
    //in a custom setting or metadata since there's no graceful
    //way to get it on the fly
    private static final String TOOLING_API_URI = '/services/data/v48.0/tooling';
    private final Http http;

    public ToolingApi() {
        this.http = new Http();
    }

    public Object getLogs() {
        //before we go in deep, at least we can
        //get the log Ids through SOQL
        Set<Id> logIds = this.queryLogIds();
        return logIds;
    }

    private Set<Id> queryLogIds() {
        //use date literal TODAY for now
        //we'll make this a trackable value later
        return new Map<Id, SObject>(
            [
                SELECT Id, Status
                FROM ApexLog
                WHERE StartTime >= TODAY
                AND Status != 'Success'
                AND Operation != 'Async Metadata'
                ORDER BY StartTime
                LIMIT 10
            ]
        ).keySet();
    }
}
```

We'll need to make a request to the Tooling API in order to get the log body by using each of the Ids in the response:

```java | classes/ToolingApi.cls
private static final String LOG_BODY_QUERY = '/sobjects/ApexLog/{0}/Body/';

public Map<String, String> getLogs() {
    Set<Id> logIds = this.queryLogIds();
    Map<String, String> logIdToLogBody = new Map<String, String>();
    for(Id logId : logIds) {
        HttpRequest logBodyReq = this.createHttpRequest();
        String logIdPath = String.format(LOG_BODY_QUERY, new List<String> { logId });
        logBodyReq.setEndpoint(logBodyReq.getEndpoint() + logIdPath);
        HttpResponse logBodyRes = this.http.Send(logBodyReq);
        logIdToLogBody.put(logId, logBodyRes.getBody());
    }

    return logIdToLogBody;
}

private HttpRequest createHttpRequest() {
    HttpRequest request = new HttpRequest();
    String baseUrl = URL.getSalesforceBaseUrl().toExternalForm();
    System.debug('Make sure this URL is included in a Remote Site Setting: ' + baseUrl);
    request.setEndpoint(baseUrl + TOOLING_API_URI);
    request.setHeader('Authorization', 'OAuth ' + UserInfo.getSessionId());
    request.setHeader('Content-Type', 'application/json');
    request.setMethod('GET');
    return request;
}

private class ToolingApiResponse {
    List<LogResponse> records { get; set;}
}

private class LogResponse {
    Id Id { get; set; }
    String Status { get; set; }
}
```

### Apex Exception Logging Roadblocks

I was starting to get pretty excited by this point. Re-executing my Anonymous Apex, I was greeted by a succesful message! Things were going great. I might even take a lunch break before finishing the rest of this off. Writing Apex is fun and easy. Little did I know I was about to hit an Apex exception logging roadblock:

![apex log exception](/img/apex-log-deleted-error.JPG)

That's what happened when I double-clicked to open the log. Expecting to see the contents of my exception logs within the log (inception?), instead I was greeted by a stone wall. What even was happening? Bizarrely, no matter what I did, this message would display any time I tried to view the combined contents of the logs. I went to sleep that night dejected, thinking that perhaps I would write about my experience, tongue-in-cheek, to show that sometimes Apex just isn't a joy. I certainly have some upcoming examples of that. Yet right before I feel asleep, I had this crazy thought ... perhaps it had been premature of me to write this experiment off as a failure after all. The Anonymous Apex had executed successfully ... perhaps the issue was with the Salesforce Developer Console's ability to render the contents of a log body from within a log itself.

Luckily, testing this theory proved easy. The next day, I wrote a little REST wrapper around the `ToolingApi` object, making use of the aforementioned [`Factory`](/dependency-injection-factory-pattern) class as well:

```java
//in the Factory
public ToolingApi getToolingApi {
    return new ToolingApi();
}

//and then a class called LogService:
@RestResource(urlMapping='/logs/*')
global class LogService {
    @HttpGet
    global static Map<String, String> getLogs() {
        return new ToolingApi().getLogs();
    }
}
```

And, using Postman to hit my newly created endpoint:

![Postman Apex Logging Service](/img/postman-logging-service.JPG)

### Apex Exception Logging - Updating Trace Flags

I hope you can see past my terrible editing skills. But this was incredible news! The gathering of the logs was complete. Now all I needed to do was create a little audit object to store the last time the logs had been queried for, and update that object accordingly. We'll call it `AuditLog__c` and it will have two custom Text fields on it: `LastPoll__c` and `LastTraceFlagUpdate__c`. Salesforce only allows trace flags, which lead to the creation of exception logs to begin with, for 24 hour periods. Every 12 or so hours, we'll have to update the traces:

```java
//in the Factory
public ToolingApi getToolingApi {
    return new ToolingApi(this);
}

public class ToolingApi {
    private static final String TOOLING_API_URI = '/services/data/v47.0/tooling';
    private static final String LOG_BODY_QUERY = '/sobjects/ApexLog/{0}/Body/';
    private static final String TRACE_DATE_FORMAT = 'yyyy-MM-dd\'T\'HH:mm:ss.SSSXXX';

    private final AuditLog__c auditLog
    private final Http http;
    private final ICrud crud;

    public ToolingApi(Factory factory) {
        this.crud = factory.Crud;
        this.http = new Http();
        //for now we'll use raw SOQL
        //till I cover the repository pattern
        this.auditLog = [SELECT Id, LastPoll__c, LastTraceFlagUpdate__c FROM AuditLog__c LIMIT 1];
    }

    public Map<String, String> getLogs() {
        Set<Id> logIds = this.queryLogIds();
        Map<String, String> logIdToLogBody = new Map<String, String>();
        for(Id logId : logIds) {
            HttpRequest logBodyReq = this.createHttpRequest();
            String logIdPath = String.format(LOG_BODY_QUERY, new List<String> { logId });
            logBodyReq.setEndpoint(logBodyReq.getEndpoint() + logIdPath);
            HttpResponse logBodyRes = this.http.Send(logBodyReq);
            logIdToLogBody.put(logId, logBodyRes.getBody());
        }

        String twelveHoursFromNow = System.now().addHours(12).format(TRACE_DATE_FORMAT);
        this.updateTraces(twelveHoursFromNow);
        this.updateAuditLog(twelveHoursFromNow);

        return logIdToLogBody;
    }

    private void updateTraces(String twelveHoursFromNow) {
        //we'll get to this in a second
        //more Tooling API joy
    }

    private void updateAuditLog(String twelveHoursFromNow) {
        this.auditLog.LastPoll__c = System.now();
        this.auditLog.LastTraceFlagUpdate__c = traceTimestamp;
        this.crud.doUpdate(this.auditLog);
    }
}
```

I'll have to go back to the Tooling API docs to re-remember how we get at those TraceFlag values ... OK, it's going to be another query, and then we'll have to do something new, which is a Tooling API update. Since we need the Id of a different kind of SObject being returned from the Tooling API, but are sort-of "object agnostic" with the rest of the potential response, we'll change the name of the previously documented `LogResponse` class to something more generic, like ... `ToolingApiRecord`

```java | classes/ToolingApi.cls
private static final String TRACE_UPDATE_QUERY = '/sobjects/TraceFlag/{0}?_HttpMethod=PATCH';

private void updateTraces(String twelveHoursFromNow) {
    String query = 'SELECT Id from TraceFlag where LogType = \'USER_DEBUG\'';
    HttpRequest request = this.getQueryRequest(query);
    HttpResponse res = this.http.Send(request);
    ToolingApiResponse toolingResponse = (ToolingApiResponse)Json.deserialize(res.getBody(), ToolingApiResponse.class);

    for(ToolingApiRecord traceRecord : toolingResponse.records) {
        HttpRequest traceRecordReq = this.createHttpRequest();
        traceRecordReq.setMethod('POST');
        String traceRecordBody = this.getTraceRecordBody(twelveHoursFromNow);
        System.debug(traceRecordBody);
        traceRecordReq.setBody(traceRecordBody);

        String traceRecordPath = String.format(TRACE_UPDATE_QUERY, new List<String> { traceRecord.Id });
        traceRecordReq.setEndpoint(traceRecordReq.getEndpoint() + traceRecordPath);
        this.http.Send(traceRecordReq);
    }
}

private String getTraceRecordBody(String twelveHoursFromNow) {
    JSONGenerator gen = JSON.createGenerator(true);
    gen.writeStartObject();
    gen.writeStringField('StartDate', System.now().format(TRACE_DATE_FORMAT));
    gen.writeStringField('ExpirationDate', twelveHoursFromNow);
    gen.writeEndObject();
    return gen.getAsString();
}

//used to be LogResponse
private class ToolingApiRecord {
    Id Id { get; set; }
}
```

Take special note of that query string parameter, `?_HttpMethod=PATCH` that's been added to the TraceFlag update URL. It wouldn't be Salesforce without some wacky hack to support a PATCH operation, since the existing HttpRequest implementation doesn't support PATCH as an HttpMethod. Classic!

Et voila! Our service is now capable of updating our TraceFlags so that we will always have logs at our disposal. That's pretty neat. The finishing touch is updating the `queryLogIds` method to take in our audit object's field so that the only logs queried are the ones that have occurred after our `LastPoll__c` value:

```java | classes/ToolingApi.cls
private Set<Id> queryLogIds() {
    return new Map<Id, SObject>(
        [
            SELECT Id, Status
            FROM ApexLog
            WHERE StartTime >= :this.auditLog.LastPoll__c
            AND Status != 'Success'
            AND Operation != 'Async Metadata'
            ORDER BY StartTime
            LIMIT 10
        ]
    ).keySet();
}
```

The hard part's over. There are still some edge cases to cover; notably, if there are more than 10 exceptions generated in-between calls to get the logs, you'll miss out on some exceptions. That and scheduling Apex to call this service are both trivial to implement, and are exercises left to the reader, as well as what to do with the log bodies once they've been gathered; you could even create a custom object and append the log bodies to a custom field if you wanted to increase the visibility of errors in the system, but I suspect that most people looking to do something like this are more interested in posting the data to another platform, aggregating exception logs for all infrastructure in a shared space.

Hopefully this post helped open your eyes to how to accomplish this within Apex itself - happy logging! The full code for the `ToolingApi` object can be viewed on [my github](https://github.com/jamessimone/apex-log-gatherer).
