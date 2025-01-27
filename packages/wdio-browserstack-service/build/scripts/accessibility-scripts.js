import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
class AccessibilityScripts {
    static instance = null;
    performScan = null;
    getResults = null;
    getResultsSummary = null;
    saveTestResults = null;
    commandsToWrap = null;
    browserstackFolderPath = path.join(os.homedir(), '.browserstack');
    commandsPath = path.join(this.browserstackFolderPath, 'commands.json');
    // don't allow to create instances from it other than through `checkAndGetInstance`
    constructor() { }
    static checkAndGetInstance() {
        if (!AccessibilityScripts.instance) {
            AccessibilityScripts.instance = new AccessibilityScripts();
            AccessibilityScripts.instance.readFromExistingFile();
        }
        return AccessibilityScripts.instance;
    }
    readFromExistingFile() {
        try {
            if (fs.existsSync(this.commandsPath)) {
                const data = fs.readFileSync(this.commandsPath, 'utf8');
                if (data) {
                    this.update(JSON.parse(data));
                }
            }
        }
        catch (error) {
            /* Do nothing */
        }
    }
    update(data) {
        if (data.scripts) {
            this.performScan = data.scripts.scan;
            this.getResults = data.scripts.getResults;
            this.getResultsSummary = data.scripts.getResultsSummary;
            this.saveTestResults = data.scripts.saveResults;
        }
        if (data.commands && data.commands.length) {
            this.commandsToWrap = data.commands;
        }
    }
    store() {
        if (!fs.existsSync(this.browserstackFolderPath)) {
            fs.mkdirSync(this.browserstackFolderPath);
        }
        fs.writeFileSync(this.commandsPath, JSON.stringify({
            commands: this.commandsToWrap,
            scripts: {
                scan: this.performScan,
                getResults: this.getResults,
                getResultsSummary: this.getResultsSummary,
                saveResults: this.saveTestResults,
            }
        }));
    }
}
export default AccessibilityScripts.checkAndGetInstance();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWNjZXNzaWJpbGl0eS1zY3JpcHRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3NjcmlwdHMvYWNjZXNzaWJpbGl0eS1zY3JpcHRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUM1QixPQUFPLEVBQUUsTUFBTSxTQUFTLENBQUE7QUFDeEIsT0FBTyxFQUFFLE1BQU0sU0FBUyxDQUFBO0FBRXhCLE1BQU0sb0JBQW9CO0lBQ2QsTUFBTSxDQUFDLFFBQVEsR0FBZ0MsSUFBSSxDQUFBO0lBRXBELFdBQVcsR0FBa0IsSUFBSSxDQUFBO0lBQ2pDLFVBQVUsR0FBa0IsSUFBSSxDQUFBO0lBQ2hDLGlCQUFpQixHQUFrQixJQUFJLENBQUE7SUFDdkMsZUFBZSxHQUFrQixJQUFJLENBQUE7SUFDckMsY0FBYyxHQUFzQixJQUFJLENBQUE7SUFFeEMsc0JBQXNCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLEVBQUUsZUFBZSxDQUFDLENBQUE7SUFDakUsWUFBWSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLHNCQUFzQixFQUFFLGVBQWUsQ0FBQyxDQUFBO0lBRTdFLG1GQUFtRjtJQUNuRixnQkFBdUIsQ0FBQztJQUVqQixNQUFNLENBQUMsbUJBQW1CO1FBQzdCLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNqQyxvQkFBb0IsQ0FBQyxRQUFRLEdBQUcsSUFBSSxvQkFBb0IsRUFBRSxDQUFBO1lBQzFELG9CQUFvQixDQUFDLFFBQVEsQ0FBQyxvQkFBb0IsRUFBRSxDQUFBO1FBQ3hELENBQUM7UUFDRCxPQUFPLG9CQUFvQixDQUFDLFFBQVEsQ0FBQTtJQUN4QyxDQUFDO0lBRU0sb0JBQW9CO1FBQ3ZCLElBQUksQ0FBQztZQUNELElBQUksRUFBRSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztnQkFDbkMsTUFBTSxJQUFJLEdBQUcsRUFBRSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsWUFBWSxFQUFFLE1BQU0sQ0FBQyxDQUFBO2dCQUN2RCxJQUFJLElBQUksRUFBRSxDQUFDO29CQUNQLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO2dCQUNqQyxDQUFDO1lBQ0wsQ0FBQztRQUNMLENBQUM7UUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1lBQ2xCLGdCQUFnQjtRQUNwQixDQUFDO0lBQ0wsQ0FBQztJQUVNLE1BQU0sQ0FBQyxJQUF1RDtRQUNqRSxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUE7WUFDcEMsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQTtZQUN6QyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQTtZQUN2RCxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFBO1FBQ25ELENBQUM7UUFDRCxJQUFJLElBQUksQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUN4QyxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUE7UUFDdkMsQ0FBQztJQUNMLENBQUM7SUFFTSxLQUFLO1FBQ1IsSUFBSSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLEVBQUMsQ0FBQztZQUM3QyxFQUFFLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxDQUFBO1FBQzdDLENBQUM7UUFFRCxFQUFFLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztZQUMvQyxRQUFRLEVBQUUsSUFBSSxDQUFDLGNBQWM7WUFDN0IsT0FBTyxFQUFFO2dCQUNMLElBQUksRUFBRSxJQUFJLENBQUMsV0FBVztnQkFDdEIsVUFBVSxFQUFFLElBQUksQ0FBQyxVQUFVO2dCQUMzQixpQkFBaUIsRUFBRSxJQUFJLENBQUMsaUJBQWlCO2dCQUN6QyxXQUFXLEVBQUUsSUFBSSxDQUFDLGVBQWU7YUFDcEM7U0FDSixDQUFDLENBQUMsQ0FBQTtJQUNQLENBQUM7O0FBR0wsZUFBZSxvQkFBb0IsQ0FBQyxtQkFBbUIsRUFBRSxDQUFBIn0=