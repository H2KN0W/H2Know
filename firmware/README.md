# H2Know Hardware Firmware

This directory contains the Arduino / ESP32 sketches (`.ino`) and associated firmware files for the H2Know IoT nodes.

## Structure

- **[`sensor_node/`](./sensor_node/)**: Place the sensor node sketch here (e.g. `sensor_node.ino`).
- **[`controller_node/`](./controller_node/)**: Place the controller / gateway node sketch here (e.g. `controller_node.ino`).

> **Note on Arduino IDE convention**: The Arduino IDE expects `.ino` sketch files to reside inside a folder sharing the exact same name (e.g. `sensor_node/sensor_node.ino` and `controller_node/controller_node.ino`).
