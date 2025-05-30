<div align="center">

# Marasi App

[![GoDoc](https://godoc.org/github.com/tfkr-ae/marasi-app?status.png)](https://godoc.org/github.com/tfkr-ae/marasi-app)

<img src="images/logo.svg" width="150" alt="Marasi">

A desktop GUI application for web application security testing built on top of the [Marasi library](https://github.com/tfkr-ae/marasi).

[marasi.app](https://marasi.app)
</div>

Marasi (مراسي) is Arabic for dockyards — places where ships are received, maintained, and dispatched. Like a dockyard for HTTP traffic, Marasi lets you intercept, inspect, modify, and extend requests as they flow through your applications.

## Features

- **Desktop GUI Interface**: Cross-platform desktop application built with Wails
- **HTTP/HTTPS Proxy**: TLS-capable proxy server with certificate management
- **Request/Response Interception**: Modify traffic in real-time with an intuitive interface
- **Lua Extensions**: Scriptable proxy behavior with built-in extensions
- **Project Management**: SQLite-based storage for all proxy data (requests, responses, metadata)
- **Launchpad**: Replay and modify HTTP requests
- **Scope Management**: Filter traffic with inclusion/exclusion rules
- **Waypoints**: Override hostnames for request routing
- **Chrome Integration**: Auto-configure Chrome with proxy settings

## Core Components

### Desktop Application
- Built with [Wails v2](https://wails.io) for cross-platform desktop functionality
- Svelte frontend with modern UI components
- Real-time event communication between frontend and backend
- Project file management with .marasi format

### Proxy Engine
- Built on [Google Martian Proxy](https://github.com/google/martian) via Marasi library

### Extension System
Lua based extension support, three built-in extensions:
- **Compass**: Scope management and traffic filtering
- **Checkpoint**: Request/response interception rules
- **Workshop**: Lua development environment

The ability to add custom extensions coming soon.

### Application File Format
SQLite-based application file format stores:
- Complete request/response data with timing
- Extension management and settings
- Launchpad entries for request replay
- Comprehensive logging system
- User notes and hostname waypoints

## Installation

### Building from Source

Requirements:
- Go
- Node.js
- Wails v2


```bash
# Install Wails
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# Clone the repository
git clone https://github.com/tfkr-ae/marasi-app
cd marasi-app

# Build the application
wails build
```

## Development

```bash
# Run in development mode
wails dev
```

## Usage

1. Launch the Marasi app
2. Continue with the scratchpad project / create a new project
3. Begin intercepting and analyzing web traffic

# GitHub Discussion
Use the [GitHub Discussion](https://github.com/tfkr-ae/marasi-app/discussions) to provide feedback, ask questions or discuss the project.