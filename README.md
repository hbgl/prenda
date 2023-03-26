# Prenda - your webpage prerenderer

[![mit license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![npm version](https://img.shields.io/npm/v/prenda.svg)](https://www.npmjs.com/package/prenda)

**⚠️ This package is still under development.**

Prenda is a service application that you can use to prerender webpages into HTML using headless Chrome. It exposes an HTTP API to which you can send your prerender requests. It opens the requested page in a new Chrome tab, waits for it to load, and returns the HTML equivalent of the current DOM. It is perfectly suited for serving prerendered SPAs to web crawlers like Googlebot for better SEO without having to deal with server side rendering (SSR).

## Table of contents

- [Installation](#installation)
- [Starting the service](#starting-the-service)
- [Usage](#usage)
- [Configuration](#configuration)
- [API](#api)
- [Why do we need another prerendering tool?](#why-do-we-need-another-prerendering-tool)
- [About](#about)

## Installation

```bash
npm install prenda --global
```

## Starting the service

```bash
prenda
```

By default the service is listening on `http://localhost:8585`.

## Usage

This example prerenders the page at [https://example.com/](https://example.com/). Notice how the request specifies a `completionTrigger` of type `event`. This tells Prenda to consider the page loaded as soon as the `load` event is dispatched on the `window` object. You can customize the prerender by passing various options (including other completion triggers) which are discussed further down below.

Request:
```bash
curl http://localhost:8585/render \
    --header 'Content-Type: application/json' \
    --header 'Accept: application/json' \
    --data '{
        "url": "https://example.com/",
        "completionTrigger": {
            "type": "event",
            "eventName": "load"
        }
    }'
```

Response:
```json
{
  "status": 200,
  "html": "<!DOCTYPE html><html>...</html>",
  "headers": {
    "content-encoding": "gzip",
    "content-length": "648",
    "content-type": "text/html; charset=UTF-8",
    "...": "..."
  },
  "completed": true
}
```

## Configuration

The Prenda service can be configured using a YAML config file. By default the application will look for `config.yaml` in the working directory. Alternatively a configuration file can be specified via command line option `--config path/to/config/file.yaml`. An [example configuration](config.example.yaml) file is provided with installation.

## API

See the dedicated [API documentation](API.md).

## Why do we need another prerendering tool?

We already have [prerender](https://github.com/prerender/prerender). So why do we need Prenda?

Well, there are two main advantages that Prenda brings to the table:

### 1. Minimal downtime headless Chrome

In its default configuration, Prenda manages a main and failover instance of headless Chrome in the background. The main instance is the one that receives all render requests. Should it crash, then the failover will immediately take over. This also means that the main instance can be periodically restarted with zero downtime and without dropping any requests.

### 2. Deterministic renders

When prerendering a page, Prenda needs to receive a signal to know when the page is loaded. For example, Prenda can be configured to listen to a specific event that you can dispatch from within your JavaScript code like so:

```js
window.dispatchEvent(new Event("Hey Prenda, the page is now loaded."));
console.log("Before this is printed, Prenda has already captured the DOM.");
```

Right when the event is dispatched, Prenda will **synchronously** capture the current DOM and return it to the caller as HTML. There is no time window for other code to modify the DOM in between. This feature may not be useful for everyone but it's nice to have some guarantees.

## TODOs

- Some tests are not 100% deterministic because of the use of `getPort`.
- Add tests that detect process leaks.

## License

MIT
https://opensource.org/licenses/mit-license.php