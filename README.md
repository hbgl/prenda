# Prenda - your webpage prerenderer

**⚠️ This package is still under development.**

Prenda is a service application that you can use to prerender webpages into HTML using headless Chrome. It exposes an HTTP API to which you can send your prerender requests. It opens the requested page in a new Chrome tab, waits for it to load, and returns the HTML equivalent of the current DOM. It is perfectly suited for serving prerendered SPAs to web crawlers like Googlebot for better SEO without having to deal with server side rendering (SSR).

## Installation

```bash
npm install prenda --global
```

## Starting the service

```bash
prenda
```

By default the service listens on `http://localhost:8585`.

## Example

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

The Prenda service can be configured using a YAML config file. By default the application will look for `config.yaml` in the working directory. Alternatively a configuration file can be specified via command line option `--config path/to/config/file.yaml`. An example configuration file is provided with installation.

## TODOs

- Some tests are not 100% deterministic because of the use of `getPort`.
- Missing documentation for config options.