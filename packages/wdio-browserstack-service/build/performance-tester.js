import { createObjectCsvWriter } from 'csv-writer';
import fs from 'node:fs';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { sleep } from './util.js';
import { BStackLogger } from './bstackLogger.js';
export default class PerformanceTester {
    static _observer;
    static _csvWriter;
    static _events = [];
    static started = false;
    static startMonitoring(csvName = 'performance-report.csv') {
        this._observer = new PerformanceObserver(list => {
            list.getEntries().forEach(entry => {
                this._events.push(entry);
            });
        });
        this._observer.observe({ buffered: true, entryTypes: ['function'] });
        this.started = true;
        this._csvWriter = createObjectCsvWriter({
            path: csvName,
            header: [
                { id: 'name', title: 'Function Name' },
                { id: 'time', title: 'Execution Time (ms)' }
            ]
        });
    }
    static getPerformance() {
        return performance;
    }
    static calculateTimes(methods) {
        const times = {};
        this._events.map((entry) => {
            if (!times[entry.name]) {
                times[entry.name] = 0;
            }
            times[entry.name] += entry.duration;
        });
        const timeTaken = methods.reduce((a, c) => {
            return times[c] + (a || 0);
        }, 0);
        BStackLogger.info(`Time for ${methods} is ${timeTaken}`);
        return timeTaken;
    }
    static async stopAndGenerate(filename = 'performance-own.html') {
        if (!this.started) {
            return;
        }
        await sleep(2000); // Wait to 2s just to finish any running callbacks for timerify
        this._observer.disconnect();
        this.started = false;
        this.generateCSV(this._events);
        const content = this.generateReport(this._events);
        const path = process.cwd() + '/' + filename;
        fs.writeFile(path, content, err => {
            if (err) {
                BStackLogger.error(`Error in writing html ${err}`);
                return;
            }
            BStackLogger.info(`Performance report is at ${path}`);
        });
    }
    static generateReport(entries) {
        let html = '<!DOCTYPE html><html><head><title>Performance Report</title></head><body>';
        html += '<h1>Performance Report</h1>';
        html += '<table><thead><tr><th>Function Name</th><th>Duration (ms)</th></tr></thead><tbody>';
        entries.forEach((entry) => {
            html += `<tr><td>${entry.name}</td><td>${entry.duration}</td></tr>`;
        });
        html += '</tbody></table></body></html>';
        return html;
    }
    static generateCSV(entries) {
        const times = {};
        entries.map((entry) => {
            if (!times[entry.name]) {
                times[entry.name] = 0;
            }
            times[entry.name] += entry.duration;
            return {
                name: entry.name,
                time: entry.duration
            };
        });
        const dat = Object.entries(times).map(([key, value]) => {
            return {
                name: key,
                time: value
            };
        });
        this._csvWriter.writeRecords(dat)
            .then(() => BStackLogger.info('Performance CSV report generated successfully'))
            .catch((error) => console.error(error));
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGVyZm9ybWFuY2UtdGVzdGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3BlcmZvcm1hbmNlLXRlc3Rlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLEVBQUUscUJBQXFCLEVBQUUsTUFBTSxZQUFZLENBQUE7QUFDbEQsT0FBTyxFQUFFLE1BQU0sU0FBUyxDQUFBO0FBQ3hCLE9BQU8sRUFBRSxXQUFXLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxpQkFBaUIsQ0FBQTtBQUNsRSxPQUFPLEVBQUUsS0FBSyxFQUFFLE1BQU0sV0FBVyxDQUFBO0FBQ2pDLE9BQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxtQkFBbUIsQ0FBQTtBQUVoRCxNQUFNLENBQUMsT0FBTyxPQUFPLGlCQUFpQjtJQUNsQyxNQUFNLENBQUMsU0FBUyxDQUFxQjtJQUNyQyxNQUFNLENBQUMsVUFBVSxDQUFLO0lBQ2QsTUFBTSxDQUFDLE9BQU8sR0FBdUIsRUFBRSxDQUFBO0lBQy9DLE1BQU0sQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFBO0lBRXRCLE1BQU0sQ0FBQyxlQUFlLENBQUMsVUFBa0Isd0JBQXdCO1FBQzdELElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsRUFBRTtZQUM1QyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFO2dCQUM5QixJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQTtZQUM1QixDQUFDLENBQUMsQ0FBQTtRQUNOLENBQUMsQ0FBQyxDQUFBO1FBQ0YsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNwRSxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQTtRQUNuQixJQUFJLENBQUMsVUFBVSxH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