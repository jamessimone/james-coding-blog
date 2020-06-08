> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Idiomatic Salesforce Apex

> :Author src=github,date=2020-02-10T15:12:03.284Z

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

We often hear the word "idiomatic" applied to programming languages to express the language-specific way of accomplishing routinely encountered problems. In this post, we dive into how to write idiomatic Salesforce Apex to make the most of each line of code as I refactoring some existing vendor code into an easier to understand format.

## The Problem

Following up on the [Apex Logging Service](/apex-logging-service) post, I was looking to push exceptions generated in Apex to [Rollbar](https://rollbar.com/error-tracking/apex/). Organizations, if they're using plenty of services beyond Salesforce, will undoubtedly be using a centralized logging solution. I've seen many [ELK-stack](https://www.elastic.co/what-is/elk-stack) approaches out there, but Rollbar (and competitors like Sumo Logic) is commonly seen on the web development side as an easy vendor to opt into, without having to worry about hosting or dashboard building. Once a company's using a vendor for one side of their logging approach, you can best believe that getting any other service's exceptions into said solution is going to be desirable -- centralize where you view exceptions being generated, and you increase the visibility of all code-related issues.

At the time, I naively assumed that because Rollbar had an Apex installed package, my conscience could rest easy going with the provided solution. I was wrong. Upon installing the Rollbar package into a sandbox, I realized quickly that there were going to be a few issues (I want to use this as an opportunity to say that I love Rollbar. I think they're a great company that provides a great service. I use their code as an opportunity to make a point in this post; I'm not trying to trash it):

- no installation customization. I wasn't looking for an Email Service to be installed, just a way to post the logs I'd already gathered to Rollbar
- no Namespace / AppExchange certification. This means that their code is competing with all other custom code for the same Salesforce limits and computational time. Ouch.
- no async log processing. Want to post something to Rollbar after performing DML? You're gonna need your own solution for that.

That being said ... no need to reinvent the wheel, I thought. You can't see namespaced code in your org unless it's a global class (and even then you can't see the full object) ... but that wasn't the case for this code, so I dove right in.

I had already seen via the documentation on Rollbar's [Apex documentation page](https://docs.rollbar.com/docs/salesforce-apex) that they were employing the Singleton pattern for accessing the logger, so that was the first thing I chose to look at:

```java
public with sharing class Rollbar {

    public static Rollbar instance() {
        if (Rollbar.instance == null) {
            Rollbar.instance = new Rollbar();
        }

        return Rollbar.instance;
    }

    public static Rollbar init()
    {
        return Rollbar.init(
            RollbarSettings__c.getInstance().AccessToken__c,
            UserInfo.getOrganizationName()
        );
    }

    public static Rollbar init(String accessToken, String environment) {
        return Rollbar.init(new Config(accessToken, environment));
    }

    public static Rollbar init(Config config) {
        Rollbar instance = instance();
        instance.config = config;
        instance.notifier = new Notifier(instance.config);
        instance.initialized = true;
        return instance;
    }

    public static HttpResponse log(String level, String message) {
        Rollbar instance = initializedInstance();
        return instance.notifier.log(level, message);
    }

    public static HttpResponse log(Exception exc) {
        Rollbar instance = initializedInstance();
        return instance.notifier.log(exc);
    }

    public static HttpResponse log(Exception exc, Map<String, Object> custom) {
        Rollbar instance = initializedInstance();
        return instance.notifier.log(exc, custom);
    }

    public static HttpResponse log(ExceptionData exData) {
        Rollbar instance = initializedInstance();
        return instance.notifier.log(exData);
    }

    private static Rollbar initializedInstance()
    {
        Rollbar instance = Rollbar.instance();
        if (!instance.initialized) {
            Rollbar.init();
        }

        return instance;
    }

    private Rollbar() {
    }

    private static Rollbar instance = null;
    private Config config = null;
    private Notifier notifier = null;
    private Boolean initialized = false;
}
```

## Refactoring Into Idiomatic Apex

Let's just leave aside all those public init methods and hone in here ...

So we've got ~ 70 lines of code mostly dealing with the problem of initializing a singleton instance / logging with strings that are actually constants.

- Idiomatic Apex allows us to initialize properties using a peculiar method that removes the need for backing members in the class
- If we can't have a proper namespace, we might as well standardize all of these file names to start with Rollbar so we know that when we see something called a Config, it's a Rollbar config; when we see something called a Notifier, we know it's a Rollbar notifier
- Let's cut out those string constants in favor of an enum
- The Rollbar singleton is taking in an API token from a Custom Setting, and the Salesforce Org name, but we don't even need that info here - we need it in the JSON object that's receivable by Rollbar

First let's review the idomatic way to initialize Singletons in Apex (edit: if you're interested in a one-liner improvement on the idiomatic singleton shown below, please read [Building A Better Singleton](/building-a-better-singleton) to learn more!):

```java
public class MyClass {
    private MyClass() {
        //prevent public initialization
        //you can still use dependency injection within your constructor though
    }

    //Singleton method
    private static MyClass Instance {
        get {
            if(Instance == null) {
                Instance = new MyClass();
            }
            return Instance;
        }
        private set;
    }

    //expose public static methods for using MyClass
    public static void sayHi() {
        Instance.say('hi');
    }

    private void say(String sayString) {
        System.debug(sayString);
    }
}
```

With that in mind, let's streamline this implementation:

```java
//in Rollbar.cls
private final Http http;
private final RollbarDataBuilder dataBuilder;

private static final String API_URI = 'https://api.rollbar.com/api/1/item/';

public enum Level { Critical, Debug, Error, Info, Warning }

private Rollbar() {
    this.dataBuilder = new RollbarDataBuilder();
    this.http = new Http();
}

public static Rollbar Instance {
    get {
        if (Instance == null) {
            Instance = new Rollbar();
        }
        return Instance;
    }
    private set;
}

public static HttpResponse log(Level level, String message) {
    Message payload = Instance.dataBuilder.build(level, message);
    return send(payload);
}

public static HttpResponse log(Exception ex) {
    Message payload = Instance.dataBuilder.build(ex);
    return send(payload);
}

private static HttpResponse send(Message payload) {
    HttpRequest request = new HttpRequest();
    request.setEndpoint(API_URI);
    request.setMethod(RestMethod.POST.name());
    //Rollbar only wants non-null properties sent over
    //The second argument suppresses null values
    request.setBody(Json.serialize(payload, true));

    HttpResponse res = Instance.http.send(request);
    if(res.getStatusCode() != 200) {
        throw new CalloutException(
            'Rollbar callout failed with response: ' + res.getBody()
        );
    }
    return res;
}
```

So what we have gained? We killed off the Notifier class (which wasn't shown, but also was just wrapping calls to the DataBuilder) in favor of the Rollbar object encapsulating the full callout. We got rid of a bunch of boilerplate related to initialization. We traded string constants for a `Rollbar.Level` enum which can easily be understood as the severity of the log being sent.

The astute reader might note that I'm not following the pattern I prescribed in [Future Methods, Callouts & Callbacks](/future-method-callout-callback/). You'd be exactly right in saying that, but I was recently reminded of this age-old adage while reading [something that came up on the React subreddit](https://jesseduffield.com/in-react-the-wrong-abstraction-kills-efficiency/):

> Duplication is far cheaper than the wrong abstraction

The Callout & Callback pattern that I documented previously is great when you have many consumers whose post-callout behavior is tightly coupled to interactions with the database or further processing is necessary. In this case, however, it would be a mistake to try to shoehorn this specific logging implementation into an abstraction meant for post-processing ... especially because having the Http object as a member of the Rollbar class will prove helpful for fully testing everything out.

But I'm getting ahead of myself. What does this DataBuilder object look like?

```java
public with sharing class DataBuilder {
    public DataBuilder(Config config) {
        this.config = config;
    }

    public Map<String, Object> buildPayload(String level, String message)
    {
        return buildPayloadStructure(level, buildMessageBody(message), null);
    }

    public Map<String, Object> buildPayload(Exception exc)
    {
        return buildPayloadStructure('error', buildExceptionBody(exc), null);
    }

    public Map<String, Object> buildPayload(Exception exc, Map<String, Object> custom)
    {
        return buildPayloadStructure('error', buildExceptionBody(exc), custom);
    }

    public Map<String, Object> buildPayload(ExceptionData exData)
    {
        Map<String, Object> custom = new Map<String, Object>();
        custom.put('context', exData.context());

        return buildPayloadStructure('error', buildTraceBody(exData), custom);
    }

    private Map<String, Object> buildExceptionBody(Exception exc)
    {
        if (exc.getCause() == null) {
            return buildTraceBody(exc);
        } else {
            return buildTraceChainBody(exc);
        }
    }

    private Map<String, Object> buildTraceChainBody(Exception exc)
    {
        Map<String, Object> outterExTrace = (Map<String, Object>)
            this.buildTraceBody(exc).get('trace');
        Map<String, Object> innerExTrace = (Map<String, Object>)
            this.buildTraceBody(exc.getCause()).get('trace');

        List<Map<String, Object>> traceChainList = new List<Map<String, Object>>();
        traceChainList.add(outterExTrace);
        traceChainList.add(innerExTrace);


        Map<String, Object> body = new Map<String, Object>();
        body.put('trace_chain', traceChainList);

        return body;
    }

    private Map<String, Object> buildPayloadStructure(
        String level,
        Map<String, Object> body,
        Map<String, Object> custom
    ) {
        Map<String, Object> data = this.buildDataStructure(
            level,
            this.config.environment(),
            body,
            custom
        );

        Map<String, Object> structure = new Map<String, Object>();
        structure.put('access_token', this.config.accessToken());
        structure.put('data', data);
        return structure;
    }

    private Map<String, Object> buildDataStructure(
        String level,
        String environment,
        Map<String, Object> body,
        Map<String, Object> custom
    ) {

        Map<String, Object> notifierMap = new Map<String, Object>();
        notifierMap.put('name', Notifier.NAME);
        notifierMap.put('version', Notifier.VERSION);

        Map<String, Object> structure = new Map<String, Object>();
        structure.put('notifier', notifierMap);
        structure.put('level', level);
        structure.put('environment', environment);
        structure.put('framework', 'apex');
        structure.put('body', body);
        structure.put('custom', custom);

        return structure;
    }

    private Map<String, Object> buildMessageBody(String message)
    {
        Map<String, Object> messageMap = new Map<String, Object>();
        messageMap.put('body', message);

        Map<String, Object> body = new Map<String, Object>();
        body.put('message', messageMap);

        return body;
    }

    private Map<String, Object> buildTraceBody(ExceptionData exData)
    {
        List<Map<String, Object>> framesList = new List<Map<String, Object>>();

        Map<String, Object> frameMap = new Map<String, Object>();
        frameMap.put('filename', exData.fileName());
        frameMap.put('class_name', exData.className());
        frameMap.put('method', exData.fileName());
        frameMap.put('lineno', exData.line());
        frameMap.put('colno', exData.column());

        framesList.add(frameMap);

        Map<String, Object> excMap = new Map<String, Object>();
        excMap.put('class', exData.className());
        excMap.put('message', exData.message());

        return buildTraceStructure(excMap, framesList);
    }

    private Map<String, Object> buildTraceBody(Exception exc)
    {
        List<Map<String, Object>> framesList = new List<Map<String, Object>>();

        String[] frames = exc.getStackTraceString().split('\n');
        for (String frameStr : frames) {
            if (frameStr == '()') {
                continue;
            } else if (frameStr.toLowerCase() == 'caused by') {
                break;
            }

            Map<String, Object> frameMap = new Map<String, Object>();
            frameMap.put('filename', frameStr);

            String className = frameStr.split(':')[0];
            String methodName = '';
            if (className != 'AnonymousBlock') {
                className = className.split('\\.')[1];
                methodName = frameStr.split(':')[0].split('\\.')[2];
            }

            frameMap.put('class_name', className);
            frameMap.put('method', methodName);

            Pattern linePattern = Pattern.compile('line (\\d+)');
            Matcher lineMatcher = linePattern.matcher(frameStr);
            lineMatcher.find();
            frameMap.put('lineno', Integer.valueOf(lineMatcher.group(1)));

            Pattern colPattern = Pattern.compile('column (\\d+)');
            Matcher colMatcher = colPattern.matcher(frameStr);
            colMatcher.find();
            frameMap.put('colno', Integer.valueOf(colMatcher.group(1)));

            framesList.add(frameMap);
        }

        Map<String, Object> excMap = new Map<String, Object>();
        excMap.put('class', exc.getTypeName());
        excMap.put('message', exc.getMessage());

        return buildTraceStructure(excMap, framesList);
    }

    private Map<String, Object> buildTraceStructure(
        Map<String, Object> exceptionMap,
        List<Map<String, Object>> framesList
    ) {
        Map<String, Object> body = new Map<String, Object>();

        Map<String, Object> traceMap = new Map<String, Object>();

        traceMap.put('exception', exceptionMap);
        traceMap.put('frames', framesList);

        body.put('trace', traceMap);

        return body;
    }

    private Config config;
}
```

Eep. Hopefully you just scrolled through that at a rapid staccato. We're using a strongly-typed language -- let's try to take advantage of that to cut down on some of the string maps here. We can also make use of the same `Rollbar.Level` enum introduced above, making it easier to differentiate between method arguments. Unfortunately, not everything will be able to be strongly typed -- if you'll notice, the JSON object that's being built here makes use of two properties, `exception` and `class`, both of which are [reserved keywords in Apex](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_reserved_words.htm).

Again, since the JSON object that's being built is singularly constrained to use with Rollbar, I'm less concerned with the tight coupling between this DataBuilder object and the Rollbar class, and more concerned with how I'd like to refer to things within a "Rollbar namespace" -- in other words, let's put those strongly typed classes into the Rollbar class, and rename the "DataBuilder" so that it's the "RollbarDataBuilder". That's idomatic Apex -- typings to help us and our tests verify that things are being shaped correctly, with descriptive names to assist:

```java
//in Rollbar.cls
public class Message {
    public String access_token { get; set; }
    public Data data { get; set; }
}

public class Data {
    public Data() {
        notifier = new Notifier();
    }
    public Notifier notifier { get; set; }
    public String level { get; set; }
    public String environment { get; set; }
    public String framework { get { set; }
    public MessageBody body { get; set; }
}

public class MessageBody {
    //trace can't be strongly typed because it has property "exception"
    // which is a reserved word in Apex
    //the "exception" property also has "class" and "message"
    //strings, and "class" is another reserved word
    public Map<String, Object> trace { get; set; }
    public List<Map<String, Object>> trace_chain { get; set; }
    public InnerMessage message { get; set; }
}

public class InnerMessage {
    public String body { get; set; }
}

public class Notifier {
    public String name { get; set;}
    public String version { get; set; }
}

public class ExceptionFrame {
    public String filename { get; set; }
    public String class_name { get; set; }
    public String method { get; set; }
    public Integer lineno { get; set; }
    public Integer colno { get; set; }
}
```

So we get a bunch of [POJOs](https://en.wikipedia.org/wiki/Plain_old_Java_object), which thanks to IDE intellisense are going to prove enormously helpful in making clear the shape of the objects being constructed.

And the much-reduced RollbarDataBuilder:

```java
public class RollbarDataBuilder {
    public static final String FRAMEWORK = 'apex';
    public static final String NAME = 'rollbar-sf-apex';
    public static final String VERSION = '1.0.0';

    public Rollbar.Message build(Rollbar.Level level, String message) {
        return buildPayloadStructure(level, buildMessageBody(message));
    }

    public Rollbar.Message build(Exception ex) {
        return buildPayloadStructure(Rollbar.Level.Error, buildExceptionBody(ex));
    }

    private Rollbar.Message buildPayloadStructure(
        Rollbar.Level level,
        Rollbar.MessageBody body) {
        Rollbar.Message message = new Rollbar.Message();
        //wherever you store secrets, be it a custom setting, object, or metadata
        message.access_token = someValue;
        message.data = this.buildDataStructure(level, body);
        return message;
    }

    private Rollbar.Data buildDataStructure(Rollbar.Level level,
        Rollbar.MessageBody body) {
        Rollbar.Data data = new Rollbar.Data();
        data.body = body;
        //I didn't like using the Org name, preferring the granularity of the Org URL.
        // You could realistically put any kind of domain-recognizable identifier here.
        data.environment = Url.getSalesforceBaseUrl().toExternalForm();
        data.framework = FRAMEWORK;
        data.level = level.name().toLowerCase();
        data.notifier.name = NAME;
        data.notifier.version = VERSION;
        return data;
    }

    private Rollbar.MessageBody buildMessageBody(String messageBody) {
        Rollbar.InnerMessage innerMessage = new Rollbar.InnerMessage();
        innerMessage.body = messageBody;

        Rollbar.MessageBody body = new Rollbar.MessageBody();
        body.message = innerMessage;
        return body;
    }

    private Rollbar.MessageBody buildExceptionBody(Exception ex) {
        if (ex.getCause() == null) {
            return buildTraceMessage(ex);
        } else {
            return buildTraceChainBody(ex);
        }
    }

    private Rollbar.MessageBody buildTraceMessage(Exception ex) {
        //note that while the typings have changed in this method
        //the underlying logic I left alone.
        List<Rollbar.ExceptionFrame> framesList = new List<Rollbar.ExceptionFrame>();

        String[] frames = ex.getStackTraceString().split('\n');
        for (String frameStr : frames) {
            if (frameStr == '()') {
                continue;
            } else if (frameStr.toLowerCase() == 'caused by') {
                break;
            }

            Rollbar.ExceptionFrame frame = new Rollbar.ExceptionFrame();
            frame.filename = frameStr;

            String className = frameStr.split(':')[0];
            String methodName = '';
            if (className != 'AnonymousBlock') {
                className = className.split('\\.')[1];
                methodName = frameStr.split(':')[0].split('\\.')[2];
            }

            frame.class_name = className;
            frame.method = methodName;

            Pattern linePattern = Pattern.compile('line (\\d+)');
            Matcher lineMatcher = linePattern.matcher(frameStr);
            lineMatcher.find();
            frame.lineno = Integer.valueOf(lineMatcher.group(1));

            Pattern colPattern = Pattern.compile('column (\\d+)');
            Matcher colMatcher = colPattern.matcher(frameStr);
            colMatcher.find();
            frame.colno = Integer.valueOf(colMatcher.group(1));

            framesList.add(frame);
        }

        Map<String, Object> excMap = new Map<String, Object>();
        excMap.put('class', exc.getTypeName());
        excMap.put('message', exc.getMessage());

        return buildTraceBody(excMap, framesList);
    }

    private Rollbar.MessageBody buildTraceBody(Map<String, Object> exceptionMap,
        List<Rollbar.ExceptionFrame> framesList) {
        Rollbar.MessageBody body = new Rollbar.MessageBody();
        body.trace = new Map<String, Object>();
        body.trace.put('exception', exceptionMap);
        body.trace.put('frames', framesList);
        return body;
    }

    private Rollbar.MessageBody buildTraceChainBody(Exception ex) {
        Map<String, Object> outterExTrace = this.buildTraceMessage(ex).trace;
        Map<String, Object> innerExTrace = this.buildTraceMessage(ex.getCause()).trace;

        List<Map<String, Object>> traceChainList = new List<Map<String, Object>>();
        traceChainList.add(outterExTrace);
        traceChainList.add(innerExTrace);

        Rollbar.MessageBody body = new Rollbar.MessageBody();
        body.trace_chain = traceChainList;
        return body;
    }
}
```

Because the DataBuilder class came with tests, it's easy to verify that this refactor, which cut the lines of code in half, is still doing exactly what we'd like it to. The tests themselves cleaned up nicely, because there was a heck of a lot less casting to `Map<String, Object>` happening. I also changed some method names; particularly for public methods, it's often a waste of characters to describe the return type in the name of the method -- intellisense will tell you the return type!

Lastly, I'll just touch on what I was talking about before -- using the Http member object on the Rollbar class to confirm end-to-end testing. Yes, we use `Test.setMock(System.HttpCalloutMock)` to properly mock API responses in tests, but in order to verify that our data is built correctly prior to sending out, having access to the body of the `HttpRequest` is paramount. Again, I typically don't like to utilize this kind of pattern, but because logging as an activity is something that's going to happen many layers deep into your application, sometimes it's necessary (as opposed to passing an object back up the entire stack):

```java
//in Rollbar.cls
private final HttpWrapper http;
private final RollbarDataBuilder dataBuilder;

private Rollbar() {
    this.dataBuilder = new RollbarDataBuilder();
    this.http = new HttpWrapper();
}

//...

@testVisible private static HttpRequest testReq;
private class HttpWrapper {
    private final Http http;
    public HttpWrapper() {
        this.http = new Http();
    }

    public HttpResponse send(HttpRequest req) {
        testReq = req;
        return this.http.send(req);
    }
}
```

This exhibits two other important idiomatic Apex patterns:

- declaring instance variables as `final` whenever possible. Let the compiler enforce for you that no changes to these members can occur. This is true of many other strongly typed languages as well, regardless of what the nomenclature is; C# uses `readonly` to the same effect, for example.
- using `@TestVisible` (or testVisible, Apex isn't case sensitive) when necessary to access deeply nested and otherwise certifiably private state variables can help to reduce test complexity and enforce that object consumers won't have access to things other than what they need in production. I always advise using this pattern _sparingly_, but there's no denying it's quite helpful.

---

## Idiomatic Apex Wrap-Up

In the end, it's a shame that some of the JSON object being sent to Rollbar made use of reserved words in Apex. This isn't something that they, as a vendor, could have anticipated; they have many SDKS across a variety of commonly used languages, and planning out their object structure with deference to one specific language is a little much to ask of anybody. Still, it made the object structure less clean than I would have liked. That the real world demands us to do things we'd prefer to avoid doing is another important lesson.

I realize I'm just brushing the surface of an extremely broad topic -- "Idiomatic Apex" would be an enormous book, if printed, and Singleton initialization and strong typing is barely a start. Have some thoughts on other excellent idiomatic Apex examples? Feel free to [reach out](https://www.jamessimone.net/contact/) -- perhaps your suggestions will inform more posts on this subject!
