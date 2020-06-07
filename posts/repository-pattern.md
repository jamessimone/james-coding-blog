> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> The Repository Pattern

Welcome back to [The Joys Of Apex](/). We've covered some fun ground with [Mocking DML](/mocking-dml), but now it's time to take your use of mocks in Apex to the next level. The end goal is to provide you with options when it comes to creating a system structure that allows you to easily get data where you need it and update that data easily in your tests. You can opt-in to this strategy if it works for you and makes sense.

I say that precisely because one of the reasons that Apex is so great is that the typical hoops you have to jump through in order to interact with a database within an object-oriented programming language have been abstracted away for you, and the existing SOQL (Salesforce Object Query Language) implementation allows for some _really_ powerful things within your codebase. Typically, SOQL usage looks something like this:

```java
List<Account> accounts = [SELECT Id, Name FROM Account WHERE Name = 'Acme'];
```

As somebody who also does quite of bit of .net programming, the sheer simplicity of interacting with the database within Apex is refreshing, to say the least. The fact that you can escape out from Apex to inject variables like lists of Salesforce Ids or lists of strings that serve as further filtering criteria is incredible. I'm advising you to not use these features. That's pretty ... polarizing ... within the SFDC community, and I can understand if you don't want to follow me down this road.

## The Problem With SOQL Usage In Large Codebases

There are two problems with utilizing SOQL like the above example:

- any time your query refers to a field or fields which are changing / being deleted, you now have to update all references to that field prior to proceeding any further. This sounds trivial -- and it should be -- but you have to keep in mind that it's extremely difficult to deprecate fields in a codebase if you don't also control all the Flows, Process Builders, formulas, etc ...
- you're constantly going to be writing queries, and if you're having to constantly do something like create Opportunity Line Items just in order to get test data prepared, you're quickly going to find out that the more DML and querying that you do in your Apex tests to mirror your production level code, the more time your tests are going to take

But how do we break out from this situation? How do we work towards a place where the tests can easily replicate the expected system data without having to essentially code for two different purposes -- one for testing, and one for the production code? As an example of a method that isn't scalable, here's one possible approach:

```java
//using the Selector pattern ...
public virtual class OpportunityLineItemRepo {
    public virtual List<OpportunityLineItem> getLineItems(Set<Id> oppIds) {
        return [
            SELECT Id, Description
            FROM OpportunityLineItem
            WHERE OpportunityId = :oppIds
        ];
    }
}

//the usage
public class OpportunityUpdater {
    private final OpportunityLineItemRepo oppLineItemRepo;

    public OpportunityUpdater(OpportunityLineItemRepo oppLineItemRepo) {
        this.oppLineItemRepo = oppLineItemRepo;
    }
}

//and then in your tests...
@isTest
private class OpportunityUpdater_Tests {
    @isTest
    static void it_should_update_opportunities_correctly() {
        //assuming we have all of these objects already initialized

        //arrange
        List<Opportunity> opps = [SELECT Id, Description FROM Opportunity LIMIT 2];
        Opportunity firstOpp = opps[0];
        Opportunity secondOpp = opps[1];

        List<OpportunityLineItem> lineItems = new List<OpportunityLineItem>{
            new OpportunityLineItem(
                OpportunityId = firstOpp.Id,
                Description = 'business logic criteria'
            )
        };

        //act
        OppLineItemRepoMock mock = new OppLineItemRepoMock();
        mock.LineItems = lineItems;
        new OpportunityUpdater(mock).updateOppsOnClose(opps);

        //assert
        System.assertEquals('Magic Business String', firstOpp.Description);
        System.assertNotEquals('Magic Business String', secondOpp.Description);
    }


    private class OppLineItemRepoMock extends OpportunityLineItemRepo {
        public List<OpportunityLineItem> LineItems { get; set; }

        public override List<OpportunityLineItem> getLineItems(Set<Id> oppIds) {
            return LineItems;
        }
    }
}
```

OK, yikes. That was a lot of code just to prove a point -- namely that going this route (which builds to the Selector pattern, where all your queries are encapsulated by methods that can then be overridden) is unsustainable. You'll need to mock every method that leads to a SOQL query; you'll need many different methods to add different filtering criteria. The Selector pattern requires a different method for each query you require, and if you'd like to override your selector methods, you're going to have your work cut out for you.

## Implementing the Repository Pattern in Apex

Correctly implementing the Repository pattern means that you only need _one_ seam, or spot where your tests do something differently from your production level code. But let's do it in true TDD style -- starting with the tests. We can even start from the same code we already have. Let's assume that over time, in a completely different section of the codebase, we're faced with a request to fetch OpportunityLineItems in order to verify that the correct Order has been created for a customer on a daily basis. If the Order needs to be updated, we want to update the existing Opportunity as well. Management will use the Description field on the Opportunity to filter on (for the purposes of this example, trying to stick to the simplest included fields possible), as they want to keep track of how often the Sales team is incorrectly keying things. This is going to lead to a potential regression in the existing code, as well as balloon the production code to deal with both scenarios. That won't be initially obvious to the team making these changes, though ...

I normally don't operate this far "down' the Salesforce sales pipeline when doing examples, because most of the "top" part of the funnel is shared between almost all SFDC orgs; whether you're using Person Accounts (sorry), or classic B2B, odds are strong that you use Opportunities, Leads, Accounts, and Contacts (and for Person Accounts, you can imagine that the Contact examples are just the corresponding fields on Person Accounts). For this example, though, I want to show that as a business expands, its business logic oftentimes leads to existing Salesforce objects being accessed in completely different ways. In order to prevent linear code growth -- and the corresponding increase in complexity and understanding that comes with that -- we want to be able to recognize commonalities shared by differing business needs.

```java
public class OrderUpdater {
    private final OpportunityLineItemRepo oppLineItemRepo;

    public OrderUpdater(OpportuniyLineItemRepo oppLineItemRepo) {
        this.oppLineItemRepo = oppLineItemRepo;
    }

    public void checkOrders(List<Order> orders) {
        Map<Id, List<Order>> accountIdToOrder = new Map<Id, List<Order>>();
        for(Order order : orders) {
            if(accountIdToOrder.containsKey(order.AccountId)) {
                List<Order> accountOrders = accountIdToOrder.get(order.AccountId);
                accountOrders.add(order);
            } else {
                accountIdToOrder.put(order.AccountId, new List<Order>{ order });
            }
        }
        //for now we use the raw SOQL
        //it's the TDD way!
        List<Opportunity> associatedOpps = [
            SELECT Id, Description
            FROM Opportunity
            WHERE IsWon = true
            AND AccountId = :accountIdToOrder.keySet()
        ];

        Map<Id, Opportunity> oppIdToOpp = new Map<Id, Opportunity>(associatedOpps);

        List<OpportunityLineItem> lineItems = this.oppLineItemRepo.getLineItems(oppIdToOpp.keySet());
        for(OpportunityLineItem lineItem : lineItems) {
            if(lineItem.Description == 'order related business logic criteria') {
                Opportunity opp = oppIdToOpp.get(lineItem.OpportunityId);
                opp.Description = 'Order Error';
            }
        }
        //etc, imagine we update the corresponding order
        //now that we know something's wrong ...
    }
}


@isTest
private class OrderUpdater_Tests {
    @isTest
    static void it_should_identify_correct_orders_based_on_opportunity_line_items() {
        //assuming things are already setup
        //arrange
        Order order = [SELECT Id, AccountId FROM Order LIMIT 1];
        Order.Description = 'Original';

        List<OpportunityLineItem> lineItems = new List<OpportunityLineItem>{
            new OpportunityLineItem(
                OpportunityId = firstOpp.Id,
                Description = 'order related business logic criteria'
            )
        };

        //act
        OppLineItemRepoMock mock = new OppLineItemRepoMock();
        mock.LineItems = lineItems;
        new OrderUpdater(mock).checkOrders(new List<Order>{ order });

        //assert
        System.assertEquals('Our new status', order.Description);
    }
}

//uh oh! We need the mock again
//for now let's pretend
//we moved it to its own class
public class OppLineItemRepoMock extends OpportunityLineItemRepo {
    public List<OpportunityLineItem> LineItems { get; set; }

    public override List<OpportunityLineItem> getLineItems(Set<Id> oppIds) {
        return LineItems;
    }
}
```

Another complicated example, and very contrived. But I hope it helps to show a few things:

1. We've introduced the need for another query; we're either going to have to introduce a new class or create a new selector method that's specific to this implementation (to filter for Closed Won opps, or to pull back the line items with the Opportunities as a child of the query). We're going to have to deal with a bunch of messy iterations in our code. Yes, we can hide the specifics by refactoring the inner body of verbose methods like `checkOrders`, but in the end, the cleanup is only going to add lines of code. As Salesforce developers, we iterate through lists, sets, and maps like crazy. Reducing the number of times we need to do that is going to help; making our database-fetching methods more controllable reduces some of the in-line iteration we need to perform to compare our objects.
2. We've introduced a subtle regression in the existing code; a regression that would likely only be detected by the astute manager or salesperson in production. Did you spot it? Now that the `OrderUpdater` is operating off of the same Description field as the `OpportunityUpdater`, the value for Description might get out of sync depending on which object fetches the Opportunities first.
3. We've had to move OppLineItemRepoMock out to its own class, and we've raised the visibility of the class as a result. One possible way around this is through sharing a Mock class:

```java
@isTest
public class MockFactory {

    public static OppLineItemRepoMock getLineItemMock() {
        return new OppLineItemRepoMock();
    }

    private class OppLineItemRepoMock extends OpportunityLineItemRepo {
        //inners
    }
}
```

But that's only going to help if every test is calling the mock in the same way. If you needed to verify that a query was being made in a particular way on top of the fact that your expected line items were being returned, you're in for a world of refactoring hurt.

### Composing repository queries

We're about to Kent Beck this whole thing. Indeed, this whole example was inspired by Kent Beck's famous "Money" example from [Test Driven Development By Example](https://www.smile.amazon.com/Test-Driven-Development-Kent-Beck/dp/0321146530). Let's start by creating a way to compose SOQL queries. We'd like for our repository to eventually be able to replicate the best of SOQL while remaining strongly typed; setting it up in such a way that no matter how many repositories are in use, there's only one per SObject **and** we only need to flip one switch in our tests in order to gain access to it. Here's a test showing my ideal syntax:

```java
@isTest
private class Repository_Tests {
    @isTest
    static void it_should_take_in_a_query() {
        Query basicQuery = new Query(Opportunity.IsWon, Query.Operator.EQUALS, true);
        IRepository repo = new Repository(
            Opportunity.SObjectType,
            new List<SObjectField>{
                Opportunity.Id
            }
        );

        repo.get(basicQuery);
        System.assertEquals(1, Limits.getQueries());
    }
}
```

As is often the case with TDD, starting with a big problem (in even getting the code to compile), means you have to stub out quite a bit just to get the code to compile.

First we'll need a way to represent queries ... we want our Query object to be comparable to another query, to consume SObjectFields, and to properly represent a few special cases in SOQL queries:

- lists / sets of Ids or Strings
- booleans
- Entering Datetimes in SOQL sucks. Let's fix that.

```java
@isTest
private class Query_Tests {
    @isTest
    static void it_should_encapsulate_sobject_fields_and_values() {
        Query basicQuery = new Query(Opportunity.IsWon, Query.Operator.EQUALS, true);

        System.assertEquals('IsWon = true', basicQuery.toString());
    }

    @isTest
    static void it_should_equal_another_query_with_the_same_values() {
        Query basicQuery = new Query(Opportunity.IsWon, Query.Operator.EQUALS, true);
        Query sameQuery = new Query(Opportunity.IsWon, Query.Operator.EQUALS, true);
        System.assertEquals(basicQuery, sameQuery);
    }

    @isTest
    static void it_should_properly_render_datetimes_as_strings() {
        Datetime sevenDaysAgo = System.now().addDays(-7);
        Query basicQuery = new Query(
            Opportunity.CreatedDate,
            Query.Operator.GREATER_THAN_OR_EQUAL,
            sevenDaysAgo
        );

        System.assertEquals(
            'CreatedDate >= ' +
                sevenDaysAgo.format('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'', 'Greenwich Mean Time'),
             basicQuery.toString()
        );
    }
}

//and then for the Repository ...
@isTest private class Repository_Tests {
    @isTest
    static void it_should_take_in_a_query() {
        Query basicQuery = new Query(Opportunity.IsWon, Query.Operator.EQUALS, true);
        IRepository repo = new Repository(Opportunity.SObjectType, new List<SObjectField>{
            Opportunity.Id
        });

        repo.get(basicQuery);
        System.assertEquals(1, Limits.getQueries());
    }

    @isTest
    static void it_should_handle_lists_and_sets_of_ids_or_strings() {
        Id accountId = TestingUtils.generateId(Account.SObjectType);
        List<Id> ids = new List<Id>{ accountId, accountId };
        Set<Id> setIds = new Set<Id>(ids);
        Set<String> oppNames = new Set<String>{ 'Open', 'Closed' };

        Query listQuery = new Query(Opportunity.Id, Query.Operator.EQUALS, ids);
        Query setQuery = new Query(Opportunity.Id, Query.Operator.EQUALS, setIds);
        Query setStringQuery = new Query(Opportunity.Name, Query.Operator.EQUALS, oppNames);

        IRepository repo = new Repository(Opportunity.SObjectType, new List<SObjectField>{
            Opportunity.Id
        });

        repo.get(listQuery);
        repo.get(setQuery);
        repo.get(setStringQuery);
        System.assertEquals(3, Limits.getQueries());
        //we need to write a special assert for sets with multiple values
        System.assertEquals('Name in (\'Closed\',\' Open\')', setStringQuery.toString());
    }
}
```

This is already going to be a long post. Kent Beck wrote "Test Driven Development By Example" in book format for a reason ... I'd love to hand-write out each iteration of the Query and Repository classes so that you can see how they develop, but we'll have to save that exercise for another time, and you'll be able to see the full code online at the end. I'll cut to the chase and show the rudimentary implementations:

```java
public class Query {
    public enum Operator {
        EQUALS,
        NOT_EQUALS,
        LESS_THAN,
        LESS_THAN_OR_EQUAL,
        GREATER_THAN,
        GREATER_THAN_OR_EQUAL
    }

    private final SObjectField field;
    private final Operator operator;
    private final List<Object> predicates;

    private static Boolean isSet = false;

    public Query(SObjectField field, Operator operator, Object predicate) {
        this(field, operator, new List<Object>{ predicate });
    }

    public Query(SObjectField field, Operator operator, List<Object> predicates) {
        this.field = field;
        this.operator = operator;
        this.predicates = predicates;
    }

    public override String toString() {
        String fieldName = this.field.getDescribe().getName();
        String predName = this.getPredicate(this.predicates);
        return fieldName + ' ' + this.getOperator() + ' ' + predName;
    }

    public Boolean equals(Object thatObject) {
        if(thatObject instanceof Query) {
            Query that = (Query) thatObject;
            return this.toString() == that.toString();
        }

        return false;
    }

    private String getOperator() {
        Boolean isList = this.predicates.size() > 1;
        switch on this.operator {
            when EQUALS {
                return isList || isSet ? 'in' : '=';
            }
            when NOT_EQUALS {
                return isList || isSet ? 'not in' : '!=';
            }
            when LESS_THAN {
                return '<';
            }
            when LESS_THAN_OR_EQUAL {
                return '<=';
            }
            when GREATER_THAN {
                return '>';
            }
            when GREATER_THAN_OR_EQUAL {
                return '>=';
            }
            when else {
                return null;
            }
        }
    }

    private String getPredicate(Object predicate) {
        if(predicate == null) {
            return 'null';
        } else if(predicate instanceof Datetime) {
            //the most annoying one
            Datetime dt = (Datetime) predicate;
            return dt.format('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'', 'Greenwich Mean Time');
        } else if(predicate instanceof List<Object>) {
            List<Object> predicates = (List<Object>) predicate;
            List<String> innerStrings = new List<String>();
            for(Object innerPred : predicates) {
                //recurse for string value
                String innerString = this.getPredicate(innerPred);
                innerStrings.add(innerString);
            }
            String start = innerStrings.size() > 1 ? '(' : '';
            String ending = innerStrings.size() > 1 ? ')' : '';
            return start + String.join(innerStrings, ',') + ending;
        } else if(predicate instanceof String) {
            String input = (String) predicate;
            return '\'' + String.escapeSingleQuotes(input) + '\'';
        }

        String predValue = String.valueOf(predicate);
        //fun fact - you can detect a list
        //but you can't detect a set!
        if(predValue.startsWith('{') && predValue.endsWith('}')) {
            List<String> setInner = predValue.substring(1, predValue.length() -1).split(',');
            isSet = setInner.size() > 1;
            return this.getPredicate(setInner);
        }
        return predValue;
    }
}
```

Our Query class will be consumed by the repository and will offer a type-safe method for SOQL query composition before passing a request to the repository. Some of its methods may grow; for example, my own version of `getPredicate` identifies objects like a `DateLiteral`, which I've created to encapsulate SOQL queries using values like:

```java
List<Opportunity> opps = [SELECT Id FROM Opportunity WHERE CreatedDate >= TODAY];
```

to something like:

```java
List<Opportunity> opps = (List<Opportunity>)repo.get(new Query(
    Opportunity.CreatedDate,
    Query.Operator.GREATER_THAN_OR_EQUAL,
    DateLiteral.TODAY)
);
```

I've also collaborated with others on improvements like support for parent-child and child-parent queries. The sky's the limit, really.

You might find such extensions impractical in your own experience; that being said, you should also be able to see how easy it would be to add features like the use of an optional "OR" flag. Similarly, you're about to see a very basic repository; at the same time, it should also be easy to see how you could short-circuit the query if an empty list is passed in, for example (which you'll be able to see [on Github](https://github.com/jamessimone/apex-mocks-stress-test/tree/repository)).

### Creating the Repository

The repository will take in a query, or a list of queries, and will execute them by composing the rest of the query. This part is pretty simple:

```java
public interface IRepository {
    List<SObject> get(Query query);
    List<SObject> get(List<Query> queries);
}

public class Repository implements IRepository {
    private final Schema.SObjectType repoType;
    private final List<Schema.SObjectField> queryFields;

    public Repository(Schema.SObjectType repoType, List<Schema.SObjectField> queryFields) {
        this.repoType = repoType;
        this.queryFields = queryFields;
    }

    public List<SObject> get(Query query) {
        return this.get(new List<Query>{ query });
    }

    public List<SObject> get(List<Query> queries) {
        String selectClause = 'SELECT ' + this.addSelectFields();
        String fromClause = '\nFROM ' + this.repoType;
        String whereClause = this.addWheres(queries);

        String finalQuery = selectClause + fromClause + whereClause;
        System.debug('Query: \n' + finalQuery);
        List<SObject> results = Database.query(finalQuery);
        System.debug('Results: \n' + results);
        return results;
    }

    private String addSelectFields() {
        Set<String> fieldStrings = new Set<String>{ 'Id' };
        for(SObjectField field : this.queryFields) {
            fieldStrings.add(field.getDescribe().getName());
        }
        return String.join(new List<String>(fieldStrings), ', ');
    }

    private String addWheres(List<Query> queries) {
        List<String> wheres = new List<String>();
        for(Query query : queries) {
            wheres.add(query.toString());
        }
        return '\nWHERE ' + String.join(wheres, '\nAND');
    }
}
```

In order to not clutter up the [Factory class](dependency-injection-factory-pattern), I like for the Factory to expose the repositories through a singleton repository factory:

```java
public virtual class Factory {
    public ICrud Crud { get; private set; }
    public RepoFactory RepoFactory { get; private set;}

    private static Factory factory;

    @testVisible
    protected Factory() {
        this.Crud = new Crud();
        this.RepoFactory = new RepoFactory();
    }

    public static Factory getFactory() {
        //production code can only initialize the factory through this method
        if(factory == null) {
            factory = new Factory();
        }

        return factory;
    }

    //factory methods for initializing objects
    @testVisible
    private Factory withMocks {
        get {
            this.Crud = new CrudMock();
            this.RepoFactory = new RepoFactoryMock();
            return this;
        }
    }
}

public virtual class RepoFactory {
    public virtual IRepository getOppRepo() {
        List<SObjectField> queryFields = new List<SObjectField>{
            Opportunity.IsWon,
            Opportunity.StageName,
            //etc ...
        };
        return new Repository(Opportunity.SObjectType, queryFields);
    }

    public virtual IRepository getOppLineItemRepo() {
        List<SObjectField> queryFields = new List<SObjectField>{
            OpportunityLineItem.Description,
            OpportunityLineItem.OpportunityId,
            //etc
        };
        return new Repository(OpportunityLineItem.SObjectType, queryFields);
    }

    //etc
}

public class RepoFactoryMock extends RepoFactory {
    @testVisible
    private static List<SObject> QueryResults = new List<SObject>();
    @testVisible
    private static List<Query> QueriesMade = new List<Query>();

    public override IRepository getOppLineItemRepo() {
        List<SObject> queriedResults = this.getResults(OpportunityLineItem.SObjectType);
        return queriedResults.size() > 0 ?
            new RepoMock(queriedResults) :
            super.getOppLineItemRepo();
    }

    private List<SObject> getResults(SObjectType sobjType) {
        List<SObject> resultList = new List<SObject>();
        for(SObject potentialResult : QueryResults) {
            if(potentialResult.getSObjectType() == sobjType) {
                resultList.add(potentialResult);
            }
        }
        return resultList;
    }

    private class RepoMock implements IRepository {
        private final List<SObject> results;

        public RepoMock(List<SObject> results) {
            this.results = results;
        }

        public List<SObject> get(Query query) {
            return this.get(new List<Query>{ query });
        }

        public List<SObject> get(List<Query> queries) {
            QueriesMade.addAll(queries);
            return this.results;
        }
    }
}
```

OK! So let's review the benefits we've gained from this structure and approach so far:

- by use of the Factory pattern, we've implemented a _single_ seam where **only** tests can gain access to repository mocks and our mock Crud implementation
- by use of a few helper methods, we've implemented a single location - `RepoFactoryMocks.QueryResult` where you can dump your expected query items across a wide swath of SObjects. With minimal boilerplate, the mock then decides per each IRepository override whether or not there are SObject results for each SObjectType and if a real or fake repository needs to be returned
- query fields per SObject are centralized in location, and because they're SObjectFields, we know for sure at deploy time that the given fields for an object exist and that their developer names have not changed. This is a zero-tolerance policy for breaking changes incorporated into your deployment workflow
- overrides in RepoFactoryMock only ever needed to be added per object when stubbing queries is practical; for my purposes, that means for all unit tests, but even if you are only incorporating this pattern gradually, you benefit from the performance increase of preventing database access while in your tests. In the meantime, you have **one** route for production level code to take; all object initialization comes through the Factory or some child class of the Factory. You can examine your code routes from the top-level down easily without having to jump all over the place.

And let's revisit our original test examples to see how they might look. Note again the use of the helper method to generate SObject Ids. I discussed this in the [Mocking DML](/mocking-dml) article previously:

```java
public class OpportunityUpdater {
    private final IRepository oppLineItemRepo;

    public OpportunityUpdater(Factory factory) {
        this.oppLineItemRepo = factory.RepoFactory.getOppLineItemRepo();
    }

    public void updateOppsOnClose(List<Opportunity> updatedOpps) {
        Map<Id, Opportunity> idtoUpdatedOpps = new Map<Id, Opportunity>(updatedOpps);

        Query oppQuery = new Query(Opportunity.Id, Query.Operator.EQUALS, idToUpdatedOpps.keySet());
        List<OpportunityLineItem> lineItems = (List<OpportunityLineItem>)this.oppLineItemRepo.get(
            oppQuery
        );
        for(OpportunityLineItem lineItem : lineItems) {
            if(lineItem.Description == 'business logic criteria') {
                Opportunity opp = idToUpdatedOpps.get(lineItem.OpportunityId);
                opp.Description = 'Magic Business String';
            }
        }
        //etc...
    }
}

//in your test class
@isTest
private class OpportunityUpdater_Tests {
    @isTest
    static void it_should_update_opportunities_correctly() {
        //arrange
        Opportunity firstOpp = new Opportunity(Id = TestingUtils.generateId(Opportunity.SObjectType));
        Opportunity secondOpp = new Opportunity(Id = TestingUtils.generateId(Opportunity.SObjectType));
        List<Opportunity> opps = new List<Opportunity>{ firstOpp, secondOpp };

        OpportunityLineItem lineItem = new OpportunityLineItem(
            OpportunityId = firstOpp.Id,
            Description = 'business logic criteria'
        );

        //act
        RepoFactoryMock.QueryResults.addAll(opps);
        RepoFactoryMock.QueryResults.add(lineItem);
        Factory.getFactory().withMocks.getOpportunityUpdater().updateOppsOnClose(opps);

        //assert
        System.assertEquals('Magic Business String', firstOpp.Description);
        System.assertNotEquals('Magic Business String', secondOpp.Description);
    }
}
```

Furthermore, because our RepoFactoryMock can tell us which queries were performed, we can easily add conditions to our OrderUpdater class and verify in the tests that the query has been updated correctly. Having a strongly typed method for comparing changes to SOQL queries is an extremely powerful tool in your toolbelt. Rather than validating that your query string has been typed correctly in raw SOQL, you can assert for that in your tests.

---

## Wrapping up

I've just gone through and outlined the _most_ barebones Repository pattern implementation within Apex. It's easily extensible, and functionality can be increased with minimal method additions in clearly delineated places.

When I needed to apply a "LIMIT" statement to a query, that functionality was easy to add. When I needed to add sorting, that was achieved through the use of another enum within the Query class and the addition of a method to the `Repository.get` method. Something that I have often thought of, though I haven't really had the need for it thus far, is re-implementing the common method seen in some mocking libraries that dictates to the mock how many results should be returned per function call. With the above implementation, it ends up being simple to add in an override on the `RepoFactoryMock` to dictate just how many of the relevant results would be returned.

The combination of the Repository and Crud classes represents the **entirety** of what's necessary to supercharge your Apex unit tests; providing the benefit of both strongly-typed testing and blazing fast test speed. It should be noted that I actually espouse the use of three different factories --

- a HandlerFactory, which can only be initialized in Triggers, whose sole responsibility is to instantiate Apex Trigger handlers (one per object! Hopefully you all learned the Handler pattern early on)
- the Factory you've seen, which passes instances of itself to all objects getting initialized so that their dependencies can be easily added (and easily swapped, as is the case with the Crud & Repository instances ...)
- the RepositoryFactory, which in my case holds the Crud getter as well as the getting methods for all IRepository instances

This pattern is the result of many years and many iterations on similar themes across various Salesforce orgs. I haven't seen a verifiably better way that leads to the same decrease in testing time and object complexity, but I'm always looking for new ways to do better. In particular, the lack of generics in Apex makes for some frustrating casting of returned objects. It would be ideal if the below were the method signatures for IRepository:

```csharp
public interface IRepository<T> where T : SObject {
   List<T> get(Query query);
   List<T> get(List<Query> queries);
}
```

But hey, that's the world we live in. The day we get lambda functions and generics in Apex will be a very exciting one indeed. I hope you enjoyed this article. I know it's a long one, but I tried to find the right balance between verbosity and justification both in the code examples and prose. You can find full examples at the code over at my [Apex Mocks repo](https://github.com/jamessimone/apex-mocks-stress-test/tree/repository), which I still haven't discussed in detail here but will in a coming post.

The long and short of it is that the use of the built-in Apex stubbing methods is not as performant as an approach like the one I'm detailing here.

Till next time!

---

Postscript -- this entire post was written on two separate plane rides on January 9th from Boston, Massachusetts to Chicago and then Chicaco to Portland, Oregon. I did not have Wifi; an interesting challenge when trying to write a language that requires an internet connection in order to be compiled. Here are the changes I had to make to get the tests passing and the code to compile:

- The version of the Query class I originally wrote did not call `getDescribe().getName()` for the passed in SObjectFields, which led to a rather hilarious query exception to be thrown due to the `@` sign in the SObjectField token
- I couldn't remember if enums could be used in switch statements in Apex. I later updated the `getOperator` method to correctly reflect this. Switch statements can be very polarizing, as well, in Apex -- they're more verbose than if statements, and the benefits you get with them are probably higher with SObjects; an enum switch statement takes up a lot of room, and only saves you the use of the full enum reference (IE `Query.Operator.EQUALS` instead of just `EQUALS` in the switch). Looking at that particular function again, I'd probably favor the if/else syntax to cut down on the lines of code
- There were a few misspellings of the word "Opportunity" -- after seven hours of flying, not that bad though!

The approach I've written about is a big improvement over the original implementations of these classes that I worked on years ago, and perhaps nothing better exemplifies that than the example test for the `OpportunityUpdater` passing on the first go. Still, I knew that my examples were lacking several key functionality aspects -- true support for Lists and Sets, in particular, and so the implementation that you'll find on the [Apex Mocks repo](https://github.com/jamessimone/apex-mocks-stress-test/tree/repository) is slightly different from the baseline implementation shown here.

If you made it this far, many thanks for taking the time to read, and I hope you enjoyed this post.
