const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
(function(globalObj) {

	function Database(dbName, dbVersion, dbDescription, dbSize, window)
	{
		// Use some parts from the client's Window object.
		var windowLocation = XPCNativeWrapper.unwrap(window.location);
		
		// useful for debugging
		var alert = XPCNativeWrapper.unwrap(window.alert);
			
		
		// Store the database file in {Profile Directory}/databases/{hostname}/{dbName}.sqlite

		var file = Cc["@mozilla.org/file/directory_service;1"]
						 .getService(Ci.nsIProperties)
						 .get("ProfD", Ci.nsIFile);
		file.append("databases");
		try{ file.create(Ci.nsIFile.DIRECTORY_TYPE, 0700); } catch (e) {};
		
		file.append(windowLocation.protocol.replace(':','') + "_" + windowLocation.hostname + "_" + windowLocation.port);
		try{ file.create(Ci.nsIFile.DIRECTORY_TYPE, 0700); } catch (e) {};
		
		file.append(dbName + ".sqlite");
		
		var storageService = Cc["@mozilla.org/storage/service;1"]
								.getService(Ci.mozIStorageService);
		var db = storageService.openDatabase(file); // Will also create the file if it does not exist
		
		function SQLTransaction() {}
		SQLTransaction.prototype = {
            __exposedProps__ : {executeSql : "r"},
            executeSql:	function (sqlStatement, arguments, callbackFunc, errorFunc) {
				var self = this;
                var parsedStatementParts = sqlStatement.split('?');
				var parsedStatement = '';
				for (var i = 1; i < parsedStatementParts.length; i++)
					parsedStatement += parsedStatementParts[i - 1] + '?' + i;
				parsedStatement += parsedStatementParts[parsedStatementParts.length - 1];
				
				// Handle create (table|index) specially, since they cause errors in createStatement() otherwise
				if (parsedStatement.match(/^CREATE /i)) {
					try {
						db.executeSimpleSQL(parsedStatement);
					}
					catch (e) {
						if (typeof callbackFunc == "function")
							errorFunc(self, e);
					}
					if (typeof callbackFunc == "function") {
						callbackFunc(self, {});
					}
					return;
				}
				
				var statement;
				try {
					statement = db.createStatement(parsedStatement);
					
					if (arguments != undefined)
					{
						var parameters = statement.newBindingParamsArray();
						var bp = parameters.newBindingParams();
						for (var i = 0; i < arguments.length; i++)
							bp.bindByIndex(i, arguments[i]);
						parameters.addParams(bp);
						statement.bindParameters(parameters);
					}
				} catch (e) {
					if (typeof errorFunc == 'function')
						errorFunc(self, e);
					return;
				}
				
				
				var sqlAsyncCallback = {};
				if (typeof callbackFunc == 'function')
				{
					var rows = [];
					sqlAsyncCallback.handleResult = function(aResultSet) {
						var nextRow;
						while (nextRow = aResultSet.getNextRow()) {
							var row = {};
							for (var i = 0; i < statement.columnCount; i++)
							{
								var colName = statement.getColumnName(i);
								row[colName] = nextRow.getResultByIndex(i);
							}
							rows.push(row);
						}
					}
					sqlAsyncCallback.handleCompletion = function(aReason) {
						if (aReason == 0)
						{
							// TODO find out how to get the number of rows affected by the query
							var rs = { 'insertId':db.lastInsertRowID, 'rowsAffected':-1, 'rows':rows };
							rs.rows.item = function(i){ return rows[i]; }
							rs.rows.length = rows.length;
							
							callbackFunc(self, rs);
						}
					}
				}
				if (typeof errorFunc == 'function')
				{
					sqlAsyncCallback.handleError = function(aError) {
						errorFunc(self, aError);
					}
				}
				
				statement.executeAsync(sqlAsyncCallback);
			}
		};
		this.__exposedProps__ = {transaction : "r", readTransaction : "r", changeVersion : "r"};
		
        this.transaction = function (callback, errorCallback, successCallback) {
			if (typeof callback != 'function')
				throw 'Callback must be a function';
			
			var tx = new SQLTransaction();
			
			try {
				try {db.beginTransaction();}catch(e){};
				callback(tx);
				try {db.commitTransaction();}catch(e){};
				if (typeof successCallback == 'function')
					successCallback();
			} catch (error) {
				try {db.rollbackTransaction();}catch(e){};
				if (typeof errorCallback == 'function')
					errorCallback(error);
			}
		}
		
		this.readTransaction = this.transaction;
		this.changeVersion = function() { /* Who cares about versions? */ }
	}

	function WebSqlFactory() {};
	WebSqlFactory.prototype = {
		classID:		Components.ID("{743f1d40-8005-11e0-b278-0800200c9a66}"),
		QueryInterface:	XPCOMUtils.generateQI([Ci.nsIDOMGlobalPropertyInitializer]),
		init:			function ws_init(aWindow)
		{
			var window = XPCNativeWrapper.unwrap(aWindow);
			function openDatabase(dbName, dbVersion, dbDescription, dbSize)
			{
				return new Database(dbName, dbVersion, dbDescription, dbSize, window);
			}
			openDatabase.toString = function(){return 'function openDatabase() {\n    [native code]\n}';};
			
			return openDatabase;
		}
	};
	
	globalObj.WebSqlFactory = WebSqlFactory;
})(this);
let NSGetFactory = XPCOMUtils.generateNSGetFactory([WebSqlFactory]);
