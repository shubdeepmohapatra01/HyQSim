# HyQSim

**Hybrid Quantum Simulator** - A visual, browser-based simulator for hybrid continuous-variable (CV) and discrete-variable (DV) quantum circuits.

## Overview

HyQSim allows you to build and simulate quantum circuits that combine traditional qubits with bosonic qumodes (quantum harmonic oscillators). This hybrid approach is essential for simulating systems like superconducting cavities coupled to transmon qubits.

### Features

- **Drag-and-drop circuit builder** - Intuitive interface for constructing quantum circuits
- **Dual backend support** - Browser-based JavaScript simulator or Python backend with bosonic-qiskit
- **Real-time visualization** - Bloch sphere for qubits, Wigner function and Fock distribution for qumodes
- **Hybrid gates** - Support for qubit-qumode interactions (controlled displacement, controlled rotation)
- **Configurable Fock truncation** - Adjust precision vs. performance tradeoff

## Architecture

```
HyQSim/
├── frontend/          # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/    # UI components
│   │   ├── simulation/    # Browser-based quantum simulator
│   │   ├── api/           # Backend API client
│   │   └── types/         # TypeScript type definitions
│   └── ...
├── backend/           # Python + FastAPI
│   ├── simulation/
│   │   ├── bosonic.py     # bosonic-qiskit integration
│   │   └── models.py      # Pydantic models
│   └── main.py            # FastAPI server
└── README.md
```

## Key Components

### Frontend Components

| Component | File | Description |
|-----------|------|-------------|
| **GatePalette** | `components/GatePalette.tsx` | Categorized list of available quantum gates |
| **CircuitCanvas** | `components/CircuitCanvas.tsx` | Main canvas for building circuits with wires and gates |
| **DisplayPanel** | `components/DisplayPanel.tsx` | Simulation controls and state visualization |
| **QubitDisplay** | `components/QubitDisplay.tsx` | Bloch sphere visualization for qubit states |
| **QumodeDisplay** | `components/QumodeDisplay.tsx` | Wigner function and Fock distribution for qumode states |

### Simulation Backends

| Backend | Location | Use Case |
|---------|----------|----------|
| **Browser (JS)** | `frontend/src/simulation/` | Quick simulations, no server required |
| **Python (bosonic-qiskit)** | `backend/simulation/bosonic.py` | Accurate CV-DV simulation using Qiskit |

### Supported Gates

**Qubit Gates:**
- Single: H, X, Y, Z, S, S†, T, Rx(θ), Ry(θ), Rz(θ)
- Two-qubit: CNOT

**Qumode Gates:**
- Displacement D(α)
- Squeeze S(z)
- Phase Rotation R(θ)
- Beam Splitter BS(θ, φ)

**Hybrid Gates:**
- Controlled Displacement CD(α)
- Controlled Rotation CR(θ)

## Customization Guide

### Adding a New Gate

1. **Define the gate** in `frontend/src/types/circuit.ts`:

```typescript
// Add to QUBIT_GATES, QUMODE_GATES, or HYBRID_GATES array
{
  id: 'mygate',           // Unique identifier
  name: 'My Gate',        // Display name
  symbol: 'MG',           // Symbol shown on circuit
  category: 'qumode',     // 'qubit', 'qumode', or 'hybrid'
  description: 'Description of what this gate does',
  numQumodes: 1,          // Number of qumodes it acts on
  parameters: [           // Optional parameters
    {
      name: 'theta',
      symbol: 'θ',
      defaultValue: Math.PI / 2,
      min: 0,
      max: 2 * Math.PI,
      step: 0.1,
      unit: 'rad'
    }
  ],
}
```

2. **Implement the gate logic** in `frontend/src/simulation/`:
   - For qubit gates: `qubit.ts` → `applyGateByName()`
   - For qumode gates: `qumode.ts` → `applyQumodeGate()`
   - For hybrid gates: `simulator.ts` → `applyHybridGate()`

3. **Add Python backend support** (if the python backend is to be used) in `backend/simulation/bosonic.py`:
   - Add gate ID to appropriate set (`SUPPORTED_QUMODE_GATES`, etc.)
   - Implement gate application in `run_bosonic_simulation()`

### Modifying Visualization

- **Bloch sphere**: Edit `QubitDisplay.tsx` - uses CSS 3D transforms
- **Wigner function**: Edit `QumodeDisplay.tsx` - computed via `computeWignerFunction()`
- **Fock distribution**: Edit `QumodeDisplay.tsx` - bar chart showing |⟨n|ψ⟩|²

### Changing the UI Theme

The app uses Tailwind CSS. Modify colors in:
- `frontend/src/index.css` - Global styles
- Individual components - Look for `className` props with color classes like `bg-slate-800`, `text-emerald-400`

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.10+
- git

#### macOS

```bash
# Install Homebrew if not installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install prerequisites
brew install node python@3.12 git
```

#### Windows

1. **Node.js**: Download and install from https://nodejs.org/ (LTS version)
2. **Python**: Download and install from https://python.org/ (check "Add to PATH" during install)
3. **git**: Download and install from https://git-scm.com/

Or using [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/):
```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
winget install Git.Git
```

### Installation

Clone the repository and run the installation script using git-bash:

```bash
git clone <repository-url>
cd HyQSim
./install.sh
```

This will:
- Install frontend dependencies (npm packages)
- Create a Python virtual environment
- Install backend dependencies
- Clone and install bosonic-qiskit

### Running HyQSim

Start both frontend and backend:

```bash
./run.sh start
```

Then open http://localhost:5173 in your browser.

### Run Commands

| Command | Description |
|---------|-------------|
| `./run.sh start` | Start both frontend and backend |
| `./run.sh stop` | Stop both servers |
| `./run.sh frontend` | Start frontend only (browser simulation) |
| `./run.sh backend` | Start backend only |
| `./run.sh status` | Check if servers are running |

### Browser-Only Mode

If you only want to use the browser-based simulator (no Python backend):

```bash
cd frontend
npm install
npm run dev
```

The simulator will run entirely in your browser with JavaScript. Some features like accurate bosonic-qiskit simulation won't be available.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Python 3.12, FastAPI, Qiskit, bosonic-qiskit
- **Visualization**: Custom Wigner function computation, CSS 3D Bloch sphere

## Acknowledgments

- [bosonic-qiskit](https://github.com/C2QA/bosonic-qiskit) by C2QA for CV-DV quantum simulation
- [Qiskit](https://qiskit.org/) for quantum computing framework
- This work is funded partially by DoE Grant DE-SC0025384, NSF grants OMA-2120757, PHY-2325080, and OSI-2410675.
