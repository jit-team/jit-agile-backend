# Project setup
To install the CLI you need to have installed npm which typically comes with NodeJS.

```https://nodejs.org/en/``` or ```brew install node```

To install or upgrade the CLI run the following npm command:

```npm -g install firebase-tools```

To verify that the CLI has been installed correctly, open a console and run:

```firebase --version```

Make sure the version of the Firebase CLI is above 4.0.0 so that it has allthe latest features required for Cloud Functions. If not, run 

```npm install -g firebase-tools``` 

to upgrade as shown above.
Authorize the Firebase CLI by running:

```firebase login```

Make sure you are in the project directory then set up the Firebase CLI to use your Firebase Project:

```firebase use --add```

Then select your Project ID and follow the instructions.

# Deploying

all functions:

```firebase deploy --only functions```

selected:

```firebase deploy --only functions:<name>```

# Changing project

```firebase use <project_name>```