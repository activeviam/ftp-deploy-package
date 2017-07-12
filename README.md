# Goal

This package is made to deploy an npm package to a remote server through FTP. It copies the package [files](https://docs.npmjs.com/files/package.json#files) and `package.json` to a temporary directory where the production [dependencies](https://docs.npmjs.com/files/package.json#dependencies) are installed. `ftp-deploy-package` then uploads all the useful files to the remote server.

# Installation

Add this package to your [devDependencies](https://docs.npmjs.com/files/package.json#devdependencies): `npm install --save-dev ftp-deploy-package`.

# Usage

`ftp-deploy-package` package is a wrapper around [ftp](https://www.npmjs.com/package/ftp). You can thus pass it all the options accepted by its [`connect` method](https://www.npmjs.com/package/ftp#methods).

## CLI

 1. Add `"deploy": "ftp-deploy-package"` to your `package.json` `scripts`
 2. Display the command help with: `npm run deploy`

Example:

```bash
npm run deploy -- --path site/wwwroot/app --host your.host.com --user "deploy\user"
```

## Node.js

```javascript
const ftpDeployPackage = require('ftp-deploy-package');

// Path to the directory containing your package.json.
const packageDirectory = 'local/path';

const ftpConfig = {
  host: 'your.host.com',
  path: 'site/wwwroot/app',
  user: 'deploy\\user'
};

ftpDeployPackage(packageDirectory, ftpConfig).then(() => {
  console.log('deploy successful');
});
```

# Testing

To test the package on your machine:
 1. `npm install`
 2. Create a `.env` file respecting the [dotenv guidelines](https://github.com/motdotla/dotenv) and add the environment variables mentioned by `index.test.js`.
 3. `npm test`
