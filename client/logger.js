class Logger {
    static logElement = null;
    static maxLogs = 50;
    static logs = [];

    static init() {
        // Create log container if it doesn't exist
        if (!this.logElement) {
            this.logElement = document.createElement('div');
            this.logElement.id = 'game-logs';
            this.logElement.style.cssText = `
                position: fixed;
                bottom: 10px;
                left: 10px;
                max-width: 600px;
                max-height: 200px;
                overflow-y: auto;
                background: rgba(0, 0, 0, 0.8);
                color: #fff;
                font-family: monospace;
                font-size: 12px;
                padding: 10px;
                border-radius: 5px;
                z-index: 1000;
                display: none;
            `;
            document.body.appendChild(this.logElement);

            // Add toggle button
            const toggleButton = document.createElement('button');
            toggleButton.textContent = 'Toggle Logs';
            toggleButton.style.cssText = `
                position: fixed;
                bottom: 10px;
                left: 10px;
                z-index: 1001;
                padding: 5px 10px;
                background: #333;
                color: #fff;
                border: none;
                border-radius: 3px;
                cursor: pointer;
            `;
            toggleButton.onclick = () => {
                this.logElement.style.display = 
                    this.logElement.style.display === 'none' ? 'block' : 'none';
            };
            document.body.appendChild(toggleButton);
        }
    }

    static formatMessage(level, message, error = null) {
        const timestamp = new Date().toISOString();
        let formattedMessage = `[${timestamp}] ${level}: ${message}`;
        if (error) {
            formattedMessage += `\n${error.stack || error.message || error}`;
        }
        return formattedMessage;
    }

    static addLogEntry(html) {
        this.logs.push(html);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        this.logElement.innerHTML = this.logs.join('<br>');
        this.logElement.scrollTop = this.logElement.scrollHeight;
    }

    static info(message) {
        const html = `<span style="color: #fff">${this.formatMessage('INFO', message)}</span>`;
        this.addLogEntry(html);
        console.log(message);
    }

    static error(message, error = null) {
        const html = `<span style="color: #ff4444">${this.formatMessage('ERROR', message, error)}</span>`;
        this.addLogEntry(html);
        console.error(message, error);
    }

    static warn(message) {
        const html = `<span style="color: #ffaa00">${this.formatMessage('WARN', message)}</span>`;
        this.addLogEntry(html);
        console.warn(message);
    }

    static debug(message) {
        const html = `<span style="color: #88ff88">${this.formatMessage('DEBUG', message)}</span>`;
        this.addLogEntry(html);
        console.debug(message);
    }
}

export default Logger; 