export class FileStream {
    readableStream;
    constructor(readableStream) {
        this.readableStream = readableStream;
    }
    stream() {
        return this.readableStream;
    }
    get [Symbol.toStringTag]() {
        return 'File';
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmlsZVN0cmVhbS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9maWxlU3RyZWFtLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUdBLE1BQU0sT0FBTyxVQUFVO0lBQ25CLGNBQWMsQ0FBMkI7SUFDekMsWUFBWSxjQUF5QztRQUNqRCxJQUFJLENBQUMsY0FBYyxHQUFHLGNBQWMsQ0FBQTtJQUN4QyxDQUFDO0lBRUQsTUFBTTtRQUNGLE9BQU8sSUFBSSxDQUFDLGNBQWMsQ0FBQTtJQUM5QixDQUFDO0lBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUM7UUFDcEIsT0FBTyxNQUFNLENBQUE7SUFDakIsQ0FBQztDQUNKIn0=