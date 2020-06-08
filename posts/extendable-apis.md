> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Extendable APIs

> :Author src=github

> :MetaOverride property=og:image
>
> ./img/joys-of-apex-thumbnail.png

API development in Apex (and pretty much every other language) is mostly bespoke, requiring the duplication of rest resources. Let's look at how we can change that using inheritance and polymorphism to power our routes. But first ...

At a certain point in everybody’s object-oriented journey, they are forced to confront a brutal truth of the world — in order to accept the power of polymorphism, sacrifices (typically) must be made. Somewhere, in the grand orchestra of closures and their concomitantly produced methods, a conductor must exist. Somewhere, things must be coupled more tightly than we would like to admit. This necessary evil wears many names; one but suits it for a short time only, and over time its etymological roots grow deeper and wider. We hear it referred to in tongues both ancient and modern, a manic susurrus with many words all converging towards one meaning:

- Factory
- Manager
- Assembler
- Processor
- Builder

This conductor comes in many forms, but it is this entity that gives shape — gives meaning! — to the greater system it surrounds. Like some demented Rube Goldberg machine, it says “if this, do that.” Like the punch-card machine code that once defaced (or graced, opinion-dependent) the depths of this planet, the conductor knows exactly which instruments should be playing at any given moment. It observes; it coordinates; it flourishes. Deciding how and when to create polymorphic objects is its _jam_.

Let’s see what good old [Uncle Bob](https://www.goodreads.com/book/show/3735293-clean-code) has to say on the subject:

> The solution to this problem is to bury the switch statement in the basement of an _ABSTRACT FACTORY_, and never let anyone see it.

Uncle Bob would have our conductor live in the **BASEMENT**. Otherwise though, his point stands (somewhat charmingly, considering how recently Apex even got switch statements).

He also says:

> Duplication may be the root of all evil in software. Many principles and practices have been created for the purpose of controlling or eliminating it.

And what does all this have to do with APIs? Is it true that we'll always need a factory method to dynamically produce polymorphic objects? Read on, dear Reader ...

---

## What A Typical Apex API Looks Like

```java
@RestResource(urlMapping='/orders/*')
global class OrderService {
    @HttpPost
    global static String post(Order order) {
        /*do something with the order
        possibly by instantiating another class
        we will just skip over this not being bulkified for now ...*/
        return 'Success';
    }
}
```

This is fine boilerplate (_probably_) in the event that you only have one or two APIs communicating with external services. For distributed systems with many needs to interact with your Salesforce instance, though, you're going to quickly find yourself saying things like: "what was the syntax for creating the API again? _goes and looks it up._ Oh, that's right, '@RestResource', and the class needs to be global ...".

Plus, every time some other team needs to interact with some of your objects, your _best case_ scenario is that they agree to honor contracts (in this case, another word for interfaces ...) you put forth as to the shape of the Salesforce objects / classes that you already have in place ... and you'll still need to go ahead and create the extra routes / API methods.

Can we come up with something more dynamic that enables the creation and organization of new and existing routes without all this mess? Can we do so while avoiding the typical Factory switch statement? How might we go about doing so?

Looking at that typical example, several insights may immediately jump to mind about the steps necessary to tame the beast:

- Because REST resources need to use static methods, this is one of the very few use-cases where I support the use of a [Facade Pattern](https://en.wikipedia.org/wiki/Facade_pattern) -- separating the concerns of calling the underlying APIs from the service where the routes are actually constructed
- If you read [Idiomatic Apex](/idiomatic-salesforce-apex/), you'll know that the best way to implement the Facade is through the use of the Apex singleton pattern
- Can we finagle a system into being that will tie the name of the route our consumers are trying to use to the objects that will handle their requests? (This, instead of the switch statement)

## Creating Dynamic Extendable APIs

Let's write a few tests for an object that will be crucial in the success of implementing a more dynamic set of rest resources within Apex. We'll need a resolver of sorts to extract what some people like to call the "needful information" from incoming rest requests (tests first!):

```java
@isTest
private class ApiRequestResolverTests {
    @isTest
    static void it_should_resolve_api_route() {
        String endpointName = 'orders';
        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/api/' + endpointName + '/';

        ApiRequestResolver resolver = new ApiRequestResolver(req);

        System.assertEquals(endpointName.capitalize(), resolver.ApiName);
    }

    @isTest
    static void it_should_handle_non_trailing_slash() {
        String endpointName = 'orders';
        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/api/' + endpointName;

        ApiRequestResolver resolver = new ApiRequestResolver(req);

        System.assertEquals(endpointName.capitalize(), resolver.ApiName);
    }

    @isTest
    static void it_should_resolve_request_body() {
        String body = '{}';
        RestRequest req = new RestRequest();
        req.requestBody = Blob.valueOf(body);

        ApiRequestResolver resolver = new ApiRequestResolver(req);

        System.assertEquals(body, resolver.RequestBody);
    }

    @isTest
    static void it_should_resolve_request_url_param() {
        String fakeAccountId = '0016g00000EPjVcXXX';
        RestRequest req = new RestRequest();
        req.requestURI = '/services/apexrest/api/account/' + fakeAccountId;

        ApiRequestResolver resolver = new ApiRequestResolver(req);

        System.assertEquals(fakeAccountId, resolver.RequestUrlBody);
    }
}
```

And the (admittedly basic) implementation:

```java
public class ApiRequestResolver {
    private final String apiBase = '/api/';

    public String ApiName { get; private set; }
    public String RequestBody { get; private set; }
    public String RequestUrlBody { get; private set; }

    public ApiRequestResolver(RestRequest req) {
        this.ApiName = this.getApiName(req.requestURI);
        this.RequestBody = req.requestBody != null ?
            req.requestBody.toString() :
            '';
        //taken straight outta the docs...
        this.RequestUrlBody = req.requestURI != null ?
            req.requestURI.substring(req.requestURI.lastIndexOf('/') + 1)
            : '';
    }

    private String getApiName(String requestURI) {
        if(requestURI == null) { return ''; }
        Integer apiNameStart = requestURI.indexOf(apiBase) + apiBase.length();
        Integer lastSlash = requestURI.lastIndexOf('/');
        Integer apiNameEnd = lastSlash < apiNameStart ? requestURI.length() : lastSlash;
        return requestURI.substring(apiNameStart, apiNameEnd).capitalize();
    }
}
```

Our master API class is minimal. It merely defines the HTTP methods that are possible. It's route-agnostic. It creates the `ApiRequestResolver`, and delegates the rest downwards:

```java
@RestResource(urlMapping='/api/*')
global class ApiService {
    private static final ApiRequestResolver resolver =
        new ApiRequestResolver(RestContext.request);

    @HttpDelete
    global static Api.Response doDelete() {
        return Api.Facade.doDelete(resolver);
    }

    @HttpGet
    global static Api.Response doGet() {
        return Api.Facade.doGet(resolver);
    }

    @HttpPatch
    global static Api.Response patch() {
        return Api.Facade.doPatch(resolver);
    }

    @HttpPost
    global static Api.Response post() {
        return Api.Facade.doPost(resolver);
    }

    @HttpPut
    global static Api.Response put() {
        return Api.Facade.doPut(resolver);
    }
}
```

The tests are simple, and a pleasure (just one route shown for brevity's sake):

```java
@isTest
private class ApiServiceTests {
    @isTest
    static void it_should_return_fail_for_not_existent_route() {
        RestContext.request = new RestRequest();
        RestContext.request.requestURI = '/api/fake/';

        Api.Response res = ApiService.doGet();

        System.assertEquals(false, res.Success);
        System.assertEquals(Api.BASIC_RESPONSE, res.ResponseBody);
    }

    @isTest
    static void it_should_return_true_for_existing_route() {
        RestContext.request = new RestRequest();
        RestContext.request.requestURI = '/api/test/';

        //have to insert the "namespace" for the test class
        //otherwise it will fail to dynamically build correctly
        Api.HANDLER_NAME = 'ApiServiceTests.' + Api.HANDLER_NAME;

        Api.Response res = ApiService.doGet();

        System.assertEquals(true, res.Success);
        System.assertEquals(TEST_RESPONSE, res.ResponseBody);
    }

    static String TEST_RESPONSE = 'test';
    public class ApiHandlerTest extends Api.Handler {
        public override Api.Response doGet(ApiRequestResolver resolver) {
            Api.Response res = this.getResponse(TEST_RESPONSE);
            res.Success = true;
            return res;
        }
    }
}
```

At a very high level, if you were to see only these tests, you would probably understand 95% of how to interact with a given API:

- there needs to be a class that extends another class called `Api.Handler`
- that class has access to override HTTP methods in order to get things done
- that class's name corresponds to route that ends up getting used

When I first wrote this article, I had the facade in a different, stand-alone, class ... but when I took a break from writing and thought more about it, I realized that for me, personally, encapsulating the different aspects of the API into one abstract class (a pseudo-namespace, in other words) was appealing. Your mileage may vary. I find things fit nicely into classes like this, provided they don't get too large; minimizing the surface area I need to grok when re-reading and re-remembering. Plus, the stand-alone facade class was still reaching into the Api class to make use of the constant `HANDLER_NAME` -- a code smell that I wasn't pleased with.

It's possible you'll have strong feelings about this pseudo-namespace and want things separated. To be clear -- I think that's perfectly fine. What works for me won't always work for you. This article is meant more as an exercise in the creation of dynamic APIs rather than an interjection on the best file structure:

```java
global abstract class Api {
    public static String HANDLER_NAME = 'ApiHandler';
    public static final String BASIC_RESPONSE = 'HTTP method not yet implemented';

    global class Response {
        global Response(String body) {
            this.Success = false;
            this.ResponseBody = body;
        }

        public Boolean Success { get; set; }
        public String ResponseBody { get; private set; }
    }

    public static Facade Facade {
        get {
            if(Facade == null) {
                Facade = new Facade();
            }
            return Facade;
        }
        private set;
    }

    public class Facade {
        private Facade() { }

        public Response doDelete(ApiRequestResolver resolver) {
            return this.getHandler(resolver).doDelete(resolver);
        }

        public Response doGet(ApiRequestResolver resolver) {
            return this.getHandler(resolver).doGet(resolver);
        }

        public Response doPatch(ApiRequestResolver resolver) {
            return this.getHandler(resolver).doPatch(resolver);
        }

        public Response doPost(ApiRequestResolver resolver) {
            return this.getHandler(resolver).doPost(resolver);
        }

        public Response doPut(ApiRequestResolver resolver) {
            return this.getHandler(resolver).doPut(resolver);
        }

        public Handler getHandler(ApiRequestResolver resolver) {
            Type handlerType = Type.forName(Api.HANDLER_NAME + resolver.ApiName);
            return handlerType != null ? (Api.Handler)handlerType.newInstance() : new Api.Handler();
        }
    }

    public virtual class Handler {
        //enforce zero argument constructor
        public Handler() { }

        public virtual Response doDelete(RequestResolver resolver) {
            return getResponse(BASIC_RESPONSE);
        }
        public virtual Response doGet(RequestResolver resolver) {
            return getResponse(BASIC_RESPONSE);
        }
        public virtual Response doPatch(RequestResolver resolver) {
            return getResponse(BASIC_RESPONSE);
        }
        public virtual Response doPost(RequestResolver resolver) {
            return getResponse(BASIC_RESPONSE);
        }
        public virtual Response doPut(RequestResolver resolver) {
            return getResponse(BASIC_RESPONSE);
        }

        protected Response getResponse(String responseBody) {
            return new Response(responseBody);
        }
    }
}
```

> :Tabs
>
> > :Tab title= Delegating to `Type.forName`
> >
> > So, in the end, our conductor has been delegated to `Type.forName(String yourTypeName)` -- a coupling that I ordinarily tend to > > shy away from; within the system, it's easy to pass around Type references (for those following along, you may recall that that > > is precisely how the [Callback](/future-method-callout-callback/) interface works), but it's not as though we > > have that luxury when interacting with cross-system consumers. Furthermore, it _makes sense_ that if a tight coupling should > > > > exist, that it be between the name of the API and the underlying objects.
>
> > :Tab title= Notes
> >
> > Now, I'm not saying that I know the underlying specifics of how "Type.forName" is implemented ... but if I had to guess Salesforce just does a lookup to the ApexClass table based on the name you provide (and the namespace, if you're in the business of creating managed packages). Not _quite_ an if/else or switch statement, but since we're delegating ... who knows!

I'll end this section by saying that I think there's plenty of room for improvement in what I'm showing off. In an actual implementation of this, for example, I would likely:

- have a method for returning successful responses in addition to a method for returning failed responses
- alternatively, have different response classes for success/fail instead of defaulting the existing class to failure

One thing I considered, but wouldn't actually do? Wrapping the virtual methods within the `Handler` in try/catch. If your operation has some chance of failing, it should be within the override that you try/catch.

## Implementing New Routes

Implementing new APIs off of the base `/api/` route is now as simple as adding classes that extend `Api.Handler` with names that start with "ApiHandler" (of course you could tweak "ApiHandler" if that naming convention doesn't appeal to you) -- I'll show an example API designed to fetch accounts. It should be noted that this GET request can be formulated either with:

- `https://instance.salesforce.com/services/apexrest/api/account/ACCOUNT_ID_HERE`
- or `https://instance.salesforce.com/services/apexrest/api/account/` with the Id in the request body (though I haven't shown this approach)

```java
public class ApiHandlerAccount extends Api.Handler {
    public final static String NOT_FOUND = 'Account Not Found';

    private final IRepository accountRepo;

    public ApiHandlerAccount() {
        super();
        //install your dependencies via the Factory
        this.accountRepo = Factory.getFactory().RepoFactory.getAccountRepo();
    }

    public override Api.Response doGet(ApiRequestResolver resolver) {
        Id accountId = Id.valueOf(resolver.RequestUrlBody);
        List<Account> accounts = this.accountRepo.get(
            new Query(
                Account.Id,
                Query.Operator.EQUALS,
                accountId
            )
        );
        Account acc = accounts.size() > 0 ?
            accounts[0] :
            new Account(Name = NOT_FOUND);

        Api.Response res = this.getResponse(Json.serialize(acc));
        res.Success = accounts.size() > 0;
        return res;
    }
}
```

You probably _wouldn't_ be serializing the whole Account to return to your calling service -- this is just an example!

If looking at that Factory statement has you going _huh!?!_ then I'll kindly refer you to the [Factory & Dependency Injection post](/dependency-injection-factory-pattern). The whole downside of `Type.forName` -- that your object is required to have a zero-argument constructor -- can be recovered from if you have the ability to quickly swap out the objects of your choice when testing, **plus** you can actually assert that you're querying for the correct things, as I'll show with the test:

```java
@isTest
private class ApiHandlerAccountTests {
    @isTest
    static void it_should_return_stringified_account_to_api() {
        /*most of my objects have a one-argument
        constructor that takes in the factory
        and they use the following syntax:
        Factory.withMocks.getClassHere.methodUnderTest
        for zero-argument constructors, we have to explicitly call
        useMocks prior to testing */
        Factory.useMocks();
        //arrange
        Id accountId = TestingUtils.generateId(Account.SObjectType);
        Account fakeAccount = new Account(Id = accountId, Name = 'ApiHandlerTest');
        RepoFactoryMock.QueryResults.add(fakeAccount);
        RestContext.request = getAccountRequest(accountId);

        //act
        Api.Response res = ApiService.doGet();
        Account deserializedAccount = (Account)Json.deserialize(
            res.ResponseBody,
            Schema.Account.class
        );

        //assert
        System.assertEquals(true, res.Success);
        System.assertEquals(accountId, deserializedAccount.Id);
        System.assertEquals(fakeAccount.Name, deserializedAccount.Name);

        Query performedQuery = RepoFactoryMock.QueriesMade[0];
        System.assertEquals(Account.Id, performedQuery.field);
        System.assertEquals(Query.Operator.EQUALS, performedQuery.operator);
        System.assertEquals(accountId, performedQuery.predicates[0]);
    }

    @isTest
    static void it_should_return_account_not_found_for_no_results() {
        //no need to mock the result
        //we can go straight to the db here
        //even though there's no result
        // it's still 8x slower than mocking!!
        RestContext.request = getAccountRequest(
            TestingUtils.generateId(Account.SObjectType)
        );

        Api.Response res = ApiService.doGet();
        Account deserializedAccount = (Account)Json.deserialize(
            res.ResponseBody,
            Schema.Account.class
        );

        System.assertEquals(false, res.Success);
        System.assertEquals(ApiHandlerAccount.NOT_FOUND, deserializedAccount.Name);
    }

    static RestRequest getAccountRequest(Id accountId) {
        RestRequest req = new RestRequest();
        req.requestURI = '/api/account/' + accountId;
        return req;
    }
}
```

And there you have it. Our first test runs in two-hundredths of a second on average, making the one-tenth of a second for the second test (the one that actually performs a SOQL query) seem positively pokey by comparison. Our first test is capable of verifying not only that the expected Account is returned to us, but also that the query that returns the Account is in fact exactly what we expect. That's huge.

## Wrapping Up

Thanks for reading this Joys Of Apex post! I sincerely hope you learned something and enjoyed the process. The full code from this example is available on [my Github](https://github.com/jamessimone/apex-mocks-stress-test/tree/dynamic-apis) if you'd like to browse through the classes in a bit more detail. It's my hope that the code will prove thought-provoking when you consider your existing APIs, and that you would consider using it on a greenfield project; for the truly brave, there's little downside to gradually migrating your existing APIs to be housed under a single route.

Of course, as with any concept, what I've talked about here doesn't cover the full breadth of what you'll need to consider when using this pattern with SFDC. Just off the top of my head:

- you'll still need to provision Remote Site Settings for users of your API
- API use validation is another concern: I would cover that from within my individual API handlers. Of course, checking for the existence of an API key or some other magic string in your headers is not fool-proof, but I would expect that the information available within the `RestContext.request` to be sufficient for most people's needs. The `ApiRequestResolver` could also be souped-up to hold these values if you, like me, dislike people accessing static globals all over the place.
