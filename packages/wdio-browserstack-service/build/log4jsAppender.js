import logReportingAPI from './logReportingAPI.js';
const BSTestOpsLogger = new logReportingAPI({});
//Disabling eslint here as there params can be used later
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function BSTestOpsLog4JSAppender(layout, timezoneOffset) {
    return (loggingEvent) => {
        BSTestOpsLogger.log({
            level: loggingEvent.level ? loggingEvent.level.levelStr : null,
            message: loggingEvent.data ? loggingEvent.data.join(' ') : null
        });
    };
}
export const configure = (config, layouts) => {
    let layout = layouts.colouredLayout;
    if (config.layout) {
        layout = layouts.layout(config.layout.type, config.layout);
    }
    return BSTestOpsLog4JSAppender(layout, config.timezoneOffset);
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9nNGpzQXBwZW5kZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvbG9nNGpzQXBwZW5kZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxlQUFlLE1BQU0sc0JBQXNCLENBQUE7QUFFbEQsTUFBTSxlQUFlLEdBQUcsSUFBSSxlQUFlLENBQUMsRUFBRSxDQUFDLENBQUE7QUFFL0MseURBQXlEO0FBQ3pELDZEQUE2RDtBQUM3RCxTQUFTLHVCQUF1QixDQUFDLE1BQWdCLEVBQUUsY0FBbUI7SUFDbEUsT0FBTyxDQUFDLFlBQWlCLEVBQUUsRUFBRTtRQUN6QixlQUFlLENBQUMsR0FBRyxDQUFDO1lBQ2hCLEtBQUssRUFBRSxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSTtZQUM5RCxPQUFPLEVBQUUsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUk7U0FDbEUsQ0FBQyxDQUFBO0lBQ04sQ0FBQyxDQUFBO0FBQ0wsQ0FBQztBQUVELE1BQU0sQ0FBQyxNQUFNLFNBQVMsR0FBRyxDQUFDLE1BQVcsRUFBRSxPQUFZLEVBQVksRUFBRTtJQUM3RCxJQUFJLE1BQU0sR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFBO0lBQ25DLElBQUksTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ2hCLE1BQU0sR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQTtJQUM5RCxDQUFDO0lBQ0QsT0FBTyx1QkFBdUIsQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFBO0FBQ2pFLENBQUMsQ0FBQSJ9