> :Hero src=/img/the-joys-of-apex.png,
> leak=156px

<br>
<br>
<br>
<br>
<br>

> :Title color=green
>
> Continuous Integration With SFDX

> :Author src=github

Updating your build pipeline to use SFDX is something that is coming up with greater and greater frequency. Many companies are still using the old metadata format for Salesforce, and perhaps the full advantage of scratch orgs and the new metadata format is still a hard sell. It's understandable. Using ANT, jsforce, or any of a dozen other legacy options for performing production deploys makes people uncomfortable; also understandable. One has only to glance at the NPM warnings when installing jsforce, for example, to have second thoughts about that particular approach. Yet for a while, wrappers around the Salesforce metadata and tooling APIs were in vogue specifically because they abstracted away the unpleasantness of working with these APIs (well, the relative unpleasantness -- one has only to examine the Marketing Cloud APIs to gain a fuller appreciation for the word _unpleasant_).

I thought I'd do a little write-up about my experience porting an older project over to the use of SFDX while still getting two big advantages:

- deletion of Apex classes when the current git repository's Apex Classes no longer include references to Apex Classes within the targeted Salesforce org
- continuous integration. I want deploys to occur when merges are accomplished on specific feature branches/the master branch. Obviously everybody's build pipeline differs, and you may have many different pre-prod environments; hopefully whatever CI system you're using supports setting up pipelines for git branches specific to that environment

## Automating Apex Class Deletion

Some time ago, my mentor and I wrote an npm package, [apex-class-cleanup](https://github.com/bruce-lindsay/apex-class-cleanup#readme) which made use of jsforce to dynamically configure the `destructiveChangesPre.xml` file that Salesforce requires be included with a metadata deployment in order to delete Apex classes prior to the tests being run -- crucial for avoiding conflicts. At the time, we used Handlebars to template out this XML file ... but it's a pretty simple file, and now with SFDX we have the use of the `sfdx force:mdapi:listmetadata` command, which removes the jsforce requirement entirely. Let's see if we can get rid of that Handlebars dependency as well ...

When you run `sfdx force:mdapi:listmetadata`, you also have the option of specifying a destination file for the output, as well as the format of the output. Using `sfdx force:mdapi:listmetadata --json -m ApexClass -f ./existingApexClasses.json`, we can grab just the Apex classes in our Salesforce org and write them to the current directory in an `existingApexClasses` json file. We don't want this file to be tracked in source control -- it should be added to our `.gitignore` file. Personally, I'd also like to clean up the file post-deployment so it doesn't stick around in my working directory, or that of my build runner.

So ... we need to get the existing Apex classes, and after the deploy has finished, perform some cleanup. This is a perfect use case for the built in `pre/post` commands baked into NPM scripts; by naming a script task `deploy`, we can then require that something run before it by naming the task to run before it `predeploy` and require that a task run after the `deploy` task has finished by naming a task `postdeploy`.

Our `package.json` file ends up looking like:

```json
"predeploy": "sfdx force:mdapi:listmetadata --json -m ApexClass -f ./existingApexClasses.json",
//the -w flag is minutes for the SFDX runner to wait for your deployment. You want this value to be higher
//than any possible increment your deploy could take ...
//the -d flag is wherever your unconverted source directory is.
//traditionally this was "src", but your mileage may vary
"deploy": "node ./createDestructiveChanges.js && sfdx force:mdapi:deploy -d \"src\" -w 10",
"postdeploy": "node ./cleanup.js"
```

So what do those `createDestructiveChanges` and `cleanup` files look like?

Let's look at how to create the XML file first:

```javascript
//in createDestructiveChanges.js
const existingClasses = require("./existingApexClasses.json");
const fs = require("fs");

const options = {
  //you could also use dotenv or something similar
  //to inject these two values by process.env values
  apiVersion: "48.0",
  classesFolder: "./src/classes/",
};

const serverFileStats = existingClasses.map(
  (existingClass) =>
    new Promise((resolve) => {
      if (
        existingClass.namespacePrefix &&
        existingClass.namespacePrefix !== ""
      ) {
        return resolve({ stat: true, existingClass });
      }
      return fs.stat(
        options.classesFolder + existingClass.fullName + ".cls",
        (err, stats) => {
          if (err) {
            return resolve({ stat: false, existingClass });
          }
          return resolve({ stat: stats, existingClass });
        }
      );
    })
);

const missingClassesPromise = () =>
  Promise.all(serverFileStats)
    .then((statAndElements) =>
      statAndElements.filter((el) => !el.stat).map((el) => el.el)
    )
    .then((extraClasses) => {
      if (extraClasses.length === 0) {
        console.log("No extra classes found.");
      }
      return { extraClasses };
    });

missingClassesPromise().then(({ extraClasses }) => {
  //I'm not saying this is the best thing in the world.
  //It's not. But the format of the XML file hasn't changed
  //And it's pretty simple to construct.
  const header = '<?xml version="1.0" encoding="UTF-8"?>';
  const packageStart =
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">';
  const typesStart = "<types>";
  const name = "<name>ApexClass</name>";
  const classes = extraClasses.map(
    (extraClass) => `<members>${extraClass.fullName}</members>`
  );
  const typesEnd = "</types>";
  const version = `<version>${options.apiVersion}</version>`;
  const packageEnd = "</Package>";
  const xmlPieces = [
    header,
    packageStart,
    typesStart,
    name,
    classes,
    typesEnd,
    version,
    packageEnd,
  ];

  const xmlContent = xmlPieces.join("\n");
  return fs.writeFileSync("src/destructiveChangesPre.xml", xmlContent);
});
```

> :Tabs
>
> > :Tab title= Create Destructive Changes Notes
> >
> > So -- `createDestructiveChanges` relies on the output from our `predeploy` step, and then compares the existing classes in our current git branch to the ones that were returned from our Salesforce org. For the ones that don't match, they're added to the `destructiveChangesPre.xml` file that Salesforce requires. The one annoyance here is that `sfdx force:mdapi:listmetadata` doesn't currently support an argument for getting only metadata from a specific namespace, so if you have installed packages on your org, they need to get filtered out first (which happens in the `serverFileStats` function, above). Also please note the important caveat that, again, this sort of thing is only going to work with the old org metadata structure
>
> > :Tab title= Footnote
> >
> > One of the big advantages in moving to packaging through SFDX is that this class cleanup happens out of the box when upgrading packages.

The cleanup file doesn't have to be anything complicated:

```javascript
const fs = require("fs");

try {
  fs.unlinkSync("./src/destructiveChangesPre.xml");
} catch {}

try {
  fs.unlinkSync("./existingApexClasses.json");
} catch {}
```

You could do the same in Bash/Powershell, as you please. It doesn't really matter. I have no preference between using node, `rm -rf`, or `Remove-Item`. Whatever floats your boat. The node implementation is shown primarily because we're talking about deploying through the use of a `package.json` file. The underlying steps to achieve this functionality remain the same, regardless of which shell / language you're using in your builds.

## Continuous Integration With SFDX

So ... locally, we have SFDX authorized to the Salesforce orgs of our choice ... but in order to securely allow for continuous integration, it's of absolutely crucial importance that we not expose our Salesforce login information except at the exact moment in our builds where we need to authorize SFDX.

In Node, at the moment, there's the popular `sfdx-cli` wrapper to allow for the use of SFDX commands through NPM. You have two essential choices when setting up CI with SFDX:

- if you (and your organization) have a pre-existing "secrets" management solution, be it Docker Secrets, Vault, CyberArk, AWS Secrets, etc ... you may feel comfortable embedding your SFDX Auth URL (retrieved through the `sfdx force:org:display --verbose`) into your existing secrets manager as is. As long as you have a way of exposing this value within your build runner's environment variables, you can then write a simple script to move this secret to a file (which is required by SFDX in order for it to be read):

```javascript
const fs = require("fs");

fs.writeFileSync("salesforce-auth", process.env.AUTH_TOKEN);
```

Or ...

```bash
echo $AUTH_TOKEN > ./salesforce-auth
```

Or even perhaps:

```powershell
$env:AUTH_TOKEN > salesforce-auth
```

Again, whatever makes you happy. Just remember to clean up that file at the end of your build! Our full build pipeline for production deploys thus becomes:

1. Auth our build runner by calling `sfdx force:auth:sfdxurl:store -f ./salesforce-auth -d"` as part of your deploy script
2. Continue on with the deploy as shown in the `package.json` example from above
3. Automate the cleanup of build artifacts with any kind of sensitive/transitive information

**OR:**

- if you either don't use a pre-existing secrets management solution or you have some other blocker, you can follow the steps outlined [in a few other places](https://salesforce.vidyard.com/watch/H3GHcWvD91oxcKeDtFksuN) to securely encrypt the value of your SFDX Auth URL for usage in your CI pipeline.

Essentially, this involves the use of a secret key known only to you/your team that functions as the SSL cipher for your SFDX Auth Url, which is then decrypted during your build.

YMMV, as they say. I personally find it likely that if a person with ill intent had taken the time to infiltrate your build system, they almost certainly also have access to wherever your remote repository is hosted; it doesn't really matter if you are using a secret key that is then going to decrypt a file you have committed to your repository with the encrypted contents of your SFDX Auth Token ... they can just extract that information in one additional step.

You can certainly make the argument that if wherever the environment variables are securely stored to begin with gets hacked, and they _only_ get the cipher key, security still has the chance through password resets and cipher recreation to protect your secrets. Again, it's a "once again removed" situation where I feel that one thing follows the other, and you're better off revoking your existing authorized user in that case.

## Wrapping Up

Getting continuous integration up and running for Salesforce is important, regardless of whether you've fully converted over to using the new metadata format or not. Hopefully we can all agree on that. For me, the icing on the cake is not having to manually delete classes when in the midst of big refactors. Whether you're using BitBucket, Gitlab, or Github, there are many options for setting up continuous integration; there are also plenty of existing integrations (CircleCI, CumulusCI , Jenkins, etc ...) that either have Salesforce / SFDX support, or outright specialize in setting up build pipelines for you.

Maybe you're curious as to what some of those underpinnings may look like when using Github Actions, Gitlab Pipelines, etc ... if so, hopefully this post proved illuminating and helpful to you. Either way, thanks for sticking with me through this journey -- not exactly our typical [Joys Of Apex](/) subject material, but an important tooling step and something that I thought worth mentioning. Till next time!
