#!/bin/bash
set -e

# Check if required environment variables are provided
if [ -z "$SF_CLIENT_ID" ]; then
    echo "Error: SF_CLIENT_ID environment variable is required"
    echo "Usage: SF_CLIENT_ID=your_id SF_CLIENT_SECRET=your_secret SF_USERNAME=your_username SF_PASSWORD=your_password ./scripts/run-local.sh"
    exit 1
fi

if [ -z "$SF_CLIENT_SECRET" ]; then
    echo "Error: SF_CLIENT_SECRET environment variable is required"
    echo "Usage: SF_CLIENT_ID=your_id SF_CLIENT_SECRET=your_secret SF_USERNAME=your_username SF_PASSWORD=your_password ./scripts/run-local.sh"
    exit 1
fi

if [ -z "$SF_USERNAME" ]; then
    echo "Error: SF_USERNAME environment variable is required"
    echo "Usage: SF_CLIENT_ID=your_id SF_CLIENT_SECRET=your_secret SF_USERNAME=your_username SF_PASSWORD=your_password ./scripts/run-local.sh"
    exit 1
fi

if [ -z "$SF_PASSWORD" ]; then
    echo "Error: SF_PASSWORD environment variable is required"
    echo "Usage: SF_CLIENT_ID=your_id SF_CLIENT_SECRET=your_secret SF_USERNAME=your_username SF_PASSWORD=your_password ./scripts/run-local.sh"
    exit 1
fi

# Optional SF_LOGIN_URL environment variable
SF_LOGIN_URL_ARG=""
if [ -n "$SF_LOGIN_URL" ]; then
    SF_LOGIN_URL_ARG="-e SF_LOGIN_URL=$SF_LOGIN_URL"
fi

# Run local development image with provided credentials
echo "Starting salesforce-cloud MCP server..."
docker run --rm -i \
  -e SF_CLIENT_ID=$SF_CLIENT_ID \
  -e SF_CLIENT_SECRET=$SF_CLIENT_SECRET \
  -e SF_USERNAME=$SF_USERNAME \
  -e SF_PASSWORD=$SF_PASSWORD \
  $SF_LOGIN_URL_ARG \
  salesforce-cloud:local
