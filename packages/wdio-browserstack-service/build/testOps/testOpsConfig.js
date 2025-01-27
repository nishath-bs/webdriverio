class TestOpsConfig {
    enabled;
    manuallySet;
    static _instance;
    buildStopped = false;
    buildHashedId;
    static getInstance(...args) {
        if (!this._instance) {
            this._instance = new TestOpsConfig(...args);
        }
        return this._instance;
    }
    constructor(enabled = true, manuallySet = false) {
        this.enabled = enabled;
        this.manuallySet = manuallySet;
        TestOpsConfig._instance = this;
    }
}
export default TestOpsConfig;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGVzdE9wc0NvbmZpZy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy90ZXN0T3BzL3Rlc3RPcHNDb25maWcudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsTUFBTSxhQUFhO0lBYUo7SUFDQTtJQWJILE1BQU0sQ0FBQyxTQUFTLENBQWU7SUFDaEMsWUFBWSxHQUFZLEtBQUssQ0FBQTtJQUM3QixhQUFhLENBQVM7SUFFN0IsTUFBTSxDQUFDLFdBQVcsQ0FBQyxHQUFHLElBQVc7UUFDN0IsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNsQixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksYUFBYSxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUE7UUFDL0MsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQTtJQUN6QixDQUFDO0lBRUQsWUFDVyxVQUFtQixJQUFJLEVBQ3ZCLGNBQXVCLEtBQUs7UUFENUIsWUFBTyxHQUFQLE9BQU8sQ0FBZ0I7UUFDdkIsZ0JBQVcsR0FBWCxXQUFXLENBQWlCO1FBRW5DLGFBQWEsQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFBO0lBQ2xDLENBQUM7Q0FDSjtBQUVELGVBQWUsYUFBYSxDQUFBIn0=