# Claude Code AI Development of a Cloudflare hosted newsletter subscription service

## The Problem

I have a personal website and blog. There might be people who want an occasional email newsletter.
My previous implementation using google function did not use bot protection which resulted in most of the registrations being bot users. Why they would want to signup for an email newsletter is beyond me.

## The Context

The website is hosted at Cloudflare and thus it seems logical to make use of "Cloudflare Workers" to implement the newsletter functionality.
With the advent of AI coding assistants it also presented it self as an opportunity to apply recommended practices to develop the solution.

## The Solution

I am working with Claude Code via browser.

Design Specification Document Prompt:
```
I am hosting a MkDocs static website at cloudflare.
I have setup a cloudflare worker to create CSP record for scripts. That is all working ok.
I want to create a page and another cloudflare worker to allow users to signup for newsletter.  Can you help create a Design-Specification-Document for this newsletter subscription service. Please ask me questions one at a time to help crate this specification.
```

After numerous questions and some suggestions we ended up with the following specification:

SDLC Specification Document Prompt:
```
Explain the SDLC that we will use.  I want to know what the development steps are from local development environment to test environment hosted in cloudflare and then finally the deployment to production environment.
Remembers that we have a versioned API url, so that breaking changes will be deployed to a new end point before we retire the old API.
We this need to be really clear on the overall pipeline from local dev to production. What the current live multiple versions of API are, and how we go about retiring superseded endpoints.
```

Task 2.1: Newsletter Subscription Worker - TDD Implementation Prompt:
```
Proceed with the TDD demonstration for Task 2.1: Create Subscription Worker
```
