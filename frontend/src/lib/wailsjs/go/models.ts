export namespace main {
	
	export class Config {
	    ConfigDir: string;
	    DesktopOS: string;
	    FirstRun: boolean;
	    VimEnabled: boolean;
	    DefaultAddress: string;
	    DefaultPort: string;
	    SyntaxMode: string;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ConfigDir = source["ConfigDir"];
	        this.DesktopOS = source["DesktopOS"];
	        this.FirstRun = source["FirstRun"];
	        this.VimEnabled = source["VimEnabled"];
	        this.DefaultAddress = source["DefaultAddress"];
	        this.DefaultPort = source["DefaultPort"];
	        this.SyntaxMode = source["SyntaxMode"];
	    }
	}
	export class Dashboard {
	    Notes: number;
	    Launchpads: number;
	    Interceptions: number;
	
	    static createFrom(source: any = {}) {
	        return new Dashboard(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Notes = source["Notes"];
	        this.Launchpads = source["Launchpads"];
	        this.Interceptions = source["Interceptions"];
	    }
	}
	export class ExtensionUI {
	    UICode: string;
	    Version: string;
	
	    static createFrom(source: any = {}) {
	        return new ExtensionUI(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.UICode = source["UICode"];
	        this.Version = source["Version"];
	    }
	}
	export class InterceptedResult {
	    raw: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new InterceptedResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.raw = source["raw"];
	        this.type = source["type"];
	    }
	}

}

export namespace marasi {
	
	export class ChromePathConfig {
	    OS: string;
	    Path: string;
	
	    static createFrom(source: any = {}) {
	        return new ChromePathConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.OS = source["OS"];
	        this.Path = source["Path"];
	    }
	}
	export class ExtensionLog {
	    // Go type: time
	    Time: any;
	    Text: string;
	
	    static createFrom(source: any = {}) {
	        return new ExtensionLog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Time = this.convertValues(source["Time"], null);
	        this.Text = source["Text"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Launchpad {
	    ID: number[];
	    Description: string;
	    Name: string;
	
	    static createFrom(source: any = {}) {
	        return new Launchpad(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.Description = source["Description"];
	        this.Name = source["Name"];
	    }
	}
	export class Log {
	    ID: number[];
	    // Go type: time
	    Timestamp: any;
	    Level: string;
	    Message: string;
	    Context: Record<string, any>;
	    RequestID: sql.NullString;
	    ExtensionID: sql.NullString;
	
	    static createFrom(source: any = {}) {
	        return new Log(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.Timestamp = this.convertValues(source["Timestamp"], null);
	        this.Level = source["Level"];
	        this.Message = source["Message"];
	        this.Context = source["Context"];
	        this.RequestID = this.convertValues(source["RequestID"], sql.NullString);
	        this.ExtensionID = this.convertValues(source["ExtensionID"], sql.NullString);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProxyRequest {
	    ID: number[];
	    Scheme: string;
	    Method: string;
	    Host: string;
	    Path: string;
	    Raw: string;
	    Metadata: Record<string, any>;
	    // Go type: time
	    RequestedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new ProxyRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.Scheme = source["Scheme"];
	        this.Method = source["Method"];
	        this.Host = source["Host"];
	        this.Path = source["Path"];
	        this.Raw = source["Raw"];
	        this.Metadata = source["Metadata"];
	        this.RequestedAt = this.convertValues(source["RequestedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProxyResponse {
	    ID: number[];
	    Status: string;
	    StatusCode: number;
	    ContentType: string;
	    Length: string;
	    Raw: string;
	    Metadata: Record<string, any>;
	    // Go type: time
	    RespondedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new ProxyResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.Status = source["Status"];
	        this.StatusCode = source["StatusCode"];
	        this.ContentType = source["ContentType"];
	        this.Length = source["Length"];
	        this.Raw = source["Raw"];
	        this.Metadata = source["Metadata"];
	        this.RespondedAt = this.convertValues(source["RespondedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace sql {
	
	export class NullString {
	    String: string;
	    Valid: boolean;
	
	    static createFrom(source: any = {}) {
	        return new NullString(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.String = source["String"];
	        this.Valid = source["Valid"];
	    }
	}

}

export namespace struct { ProjectName string; Date string } {
	
	export class  {
	    ProjectName: string;
	    Date: string;
	
	    static createFrom(source: any = {}) {
	        return new (source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ProjectName = source["ProjectName"];
	        this.Date = source["Date"];
	    }
	}

}

