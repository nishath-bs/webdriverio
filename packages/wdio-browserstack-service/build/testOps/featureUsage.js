import { getErrorString } from '../util.js';
class FeatureUsage {
    isTriggered;
    status;
    error;
    constructor(isTriggered) {
        if (isTriggered !== undefined) {
            this.isTriggered = isTriggered;
        }
    }
    getTriggered() {
        return this.isTriggered;
    }
    setTriggered(triggered) {
        this.isTriggered = triggered;
    }
    setStatus(status) {
        this.status = status;
    }
    setError(error) {
        this.error = error;
    }
    triggered() {
        this.isTriggered = true;
    }
    failed(e) {
        this.status = 'failed';
        this.error = getErrorString(e);
    }
    success() {
        this.status = 'success';
    }
    getStatus() {
        return this.status;
    }
    getError() {
        return this.error;
    }
    toJSON() {
        return {
            isTriggered: this.isTriggered,
            status: this.status,
            error: this.error
        };
    }
}
export default FeatureUsage;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmVhdHVyZVVzYWdlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Rlc3RPcHMvZmVhdHVyZVVzYWdlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSxZQUFZLENBQUE7QUFFM0MsTUFBTSxZQUFZO0lBQ04sV0FBVyxDQUFVO0lBQ3JCLE1BQU0sQ0FBUztJQUNmLEtBQUssQ0FBUztJQUV0QixZQUFZLFdBQXFCO1FBQzdCLElBQUksV0FBVyxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQzVCLElBQUksQ0FBQyxXQUFXLEdBQUcsV0FBVyxDQUFBO1FBQ2xDLENBQUM7SUFDTCxDQUFDO0lBRU0sWUFBWTtRQUNmLE9BQU8sSUFBSSxDQUFDLFdBQVcsQ0FBQTtJQUMzQixDQUFDO0lBRU0sWUFBWSxDQUFDLFNBQWtCO1FBQ2xDLElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFBO0lBQ2hDLENBQUM7SUFFTSxTQUFTLENBQUMsTUFBYztRQUMzQixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQTtJQUN4QixDQUFDO0lBRU0sUUFBUSxDQUFDLEtBQWE7UUFDekIsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUE7SUFDdEIsQ0FBQztJQUVNLFNBQVM7UUFDWixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQTtJQUMzQixDQUFDO0lBRU0sTUFBTSxDQUFDLENBQVU7UUFDcEIsSUFBSSxDQUFDLE1BQU0sR0FBRyxRQUFRLENBQUE7UUFDdEIsSUFBSSxDQUFDLEtBQUssR0FBRyxjQUFjLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDbEMsQ0FBQztJQUVNLE9BQU87UUFDVixJQUFJLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQTtJQUMzQixDQUFDO0lBRU0sU0FBUztRQUNaLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQTtJQUN0QixDQUFDO0lBRU0sUUFBUTtRQUNYLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQTtJQUNyQixDQUFDO0lBRU0sTUFBTTtRQUNULE9BQU87WUFDSCxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVc7WUFDN0IsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNO1lBQ25CLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSztTQUNwQixDQUFBO0lBQ0wsQ0FBQztDQUNKO0FBRUQsZUFBZSxZQUFZLENBQUEifQ==