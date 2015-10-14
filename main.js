var esprima = require("esprima");
var options = {tokens:true, tolerant: true, loc: true, range: true };
var faker = require("faker");
var fs = require("fs");
faker.locale = "en";
var mock = require('mock-fs');
var _ = require('underscore');
var Random = require('random-js');

function main()
{
	var args = process.argv.slice(2);

	if( args.length == 0 )
	{
		args = ["subject.js"];
	}
	var filePath = args[0];

	constraints(filePath);

	generateTestCases()

}

var engine = Random.engines.mt19937().autoSeed();

function createConcreteIntegerValue( greaterThan, constraintValue )
{
	if( greaterThan )
		return Random.integer(constraintValue,constraintValue+10)(engine);
	else
		return Random.integer(constraintValue-10,constraintValue)(engine);
}

function Constraint(properties)
{
	this.ident = properties.ident;
	this.expression = properties.expression;
	this.operator = properties.operator;
	this.value = properties.value;
	this.funcName = properties.funcName;
	// Supported kinds: "fileWithContent","fileExists"
	// integer, string, phoneNumber
	this.kind = properties.kind;
}

function fakeDemo()
{
	console.log( faker.phone.phoneNumber() );
	console.log( faker.phone.phoneNumberFormat() );
	console.log( faker.phone.phoneFormats() );
}

var functionConstraints =
{
}

var mockFileLibrary = 
{
	pathExists:
	{
		'path/fileExists': {}
	},
	fileWithContent:
	{
		pathContent: 
		{	
  			file1: 'text content',
		}
	}

};

function generateTestCases()
{

	var content = "var subject = require('./subject.js')\nvar mock = require('mock-fs');\n";
	for ( var funcName in functionConstraints )
	{
		console.log('---------------------------function-------------------------------');
		console.log(funcName);

		var params = {};

		// initialize params
		for (var i =0; i < functionConstraints[funcName].params.length; i++ )
		{
			var paramName = functionConstraints[funcName].params[i];
			//params[paramName] = '\'' + faker.phone.phoneNumber()+'\'';
			params[paramName] = '\'\'';
		}

		//console.log( params );

		// update parameter values based on known constraints.
		var constraints = functionConstraints[funcName].constraints;
		console.log('--------------constraints--------------');
		console.log(constraints);

		// Handle global constraints...
		var fileWithContent = _.some(constraints, {kind: 'fileWithContent' });
		var pathExists      = _.some(constraints, {kind: 'fileExists' });

		// plug-in values for parameters
		for( var c = 0; c < constraints.length; c++ )
		{
			var constraint = constraints[c];
			
			if( params.hasOwnProperty( constraint.ident ) )
			{
				params[constraint.ident] = constraint.value;
			}
		}

		// Prepare function arguments.
		var args = Object.keys(params).map( function(k) {return params[k]; }).join(",");
		console.log('--------------args--------------');
		console.log(args);
		

		variables = new Object();
		for ( var funcName in functionConstraints )
		{
			var params = {};
			variables[funcName] = new Array( functionConstraints[funcName].params.length );
			for (var i =0; i < functionConstraints[funcName].params.length; i++ )
			{
				var paramName = functionConstraints[funcName].params[i];
				params[paramName] = '\'\'';
		}
		var constraints = functionConstraints[funcName].constraints;
		for( var c = 0; c < constraints.length; c++ )
		{
			var constraint = constraints[c];
			index = functionConstraints[funcName].params.indexOf(constraint.ident);
			if( typeof variables[funcName][index] == "undefined" ) variables[funcName][index] = [];
			if( typeof constraint.ident !== "undefined" )
			{
				variables[funcName][index].push( constraint.value );
				if( typeof constraint.inverse != "undefined" )
				{
					variables[funcName][index].push( constraint.inverse );
				}
			}
		}

		var len = 1;
		for( var i = 0; i < functionConstraints[funcName].params.length; i++ )
		{
			if( typeof variables[funcName][i] == "undefined" ) variables[funcName][i] = [ "\'\'" ];
			else len *= variables[funcName][i].length;
		}

		for( var i = 0; i < len; i++ )
		{
			var params_list = [];
			var x = i;
			for( var j = 0; j < functionConstraints[funcName].params.length; j ++ )
			{
				params_list[j] = variables[funcName][j][x % variables[funcName][j].length];
				x = Math.floor( x / variables[funcName][j].length );
			}

			var args = params_list.join(",");
			content += "subject.{0}({1});\n".format(funcName, args );
		}

	}
	//console.log(variables);


		if( pathExists || fileWithContent )
		{
			content += generateMockFsTestCases(pathExists,fileWithContent,funcName, args);
			// Bonus...generate constraint variations test cases....
			content += generateMockFsTestCases(!pathExists,fileWithContent,funcName, args);
			content += generateMockFsTestCases(pathExists,!fileWithContent,funcName, args);
			content += generateMockFsTestCases(!pathExists,!fileWithContent,funcName, args);
		}
		else
		{
			// Emit simple test case.
			content += "subject.{0}({1});\n".format(funcName, args );
		}

	}
	


	fs.writeFileSync('test.js', content, "utf8");

}

function generateMockFsTestCases (pathExists,fileWithContent,funcName,args) 
{
	var testCase = "";
	// Build mock file system based on constraints.
	var mergedFS = {};
	if( pathExists )
	{
		for (var attrname in mockFileLibrary.pathExists) { mergedFS[attrname] = mockFileLibrary.pathExists[attrname]; }
	}
	if( fileWithContent )
	{
		for (var attrname in mockFileLibrary.fileWithContent) { mergedFS[attrname] = mockFileLibrary.fileWithContent[attrname]; }
	}

	testCase += 
	"mock(" +
		JSON.stringify(mergedFS)
		+
	");\n";

	testCase += "\tsubject.{0}({1});\n".format(funcName, args );
	testCase+="mock.restore();\n";
	return testCase;
}

function constraints(filePath)
{
   var buf = fs.readFileSync(filePath, "utf8");
	var result = esprima.parse(buf, options);

	traverse(result, function (node) 
	{
		if (node.type === 'FunctionDeclaration') 
		{
			var funcName = functionName(node);
			console.log("Line : {0} Function: {1}".format(node.loc.start.line, funcName ));

			var params = node.params.map(function(p) {return p.name});

			functionConstraints[funcName] = {constraints:[], params: params};

			// Check for expressions using argument.
			traverse(node, function(child)
			{
				if( child.type === 'BinaryExpression' && child.operator == "==" )
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) >= 0)
					{
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])
						if(typeof(rightHand) == 'string')
						{
							if (rightHand !='undefined')
							{
								mutatedRightHand =  [rightHand.slice(0,1), "not", rightHand.slice(1)].join('');
								functionConstraints[funcName].constraints.push( 
									new Constraint(
							{
								ident: child.left.name,
								value: mutatedRightHand,
								funcName: funcName,
								kind: 'string',
								operator : child.operator,
								expression: expression
							}));
							}
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: rightHand,
								funcName: funcName,
								kind: "string",
								operator : child.operator,
								expression: expression
							}));
						}
						else
						{
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: parseInt(rightHand) + 7,
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: parseInt(rightHand),
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));

						}

					}
				}

				if( child.type === 'BinaryExpression' && child.operator == '!=' )
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) >= 0)
					{
						// get expression from original source code:
						// console.log("^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^")
						var expression = buf.substring(child.range[0], child.range[1]);
						// console.log("EXPRESSION=>"+expression);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])
						if(typeof(rightHand) == 'string')
						{
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: rightHand,
								funcName: funcName,
								kind: 'string',
								operator : child.operator,
								expression: expression
							}));
							if (rightHand!='undefined')
							{
								mutatedRightHand =  [rightHand.slice(0,1), "not", rightHand.slice(1)].join('');
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: mutatedRightHand,
								funcName: funcName,
								kind: 'string',
								operator : child.operator,
								expression: expression
							}));
							}
							
						}
						else
						{
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: parseInt(rightHand),
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: parseInt(rightHand)+7,
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));
						}
					}
				}
				
				if( child.type === 'BinaryExpression' && child.operator == "<")
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1)
					{
						// get expression from original source code:
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])

						functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: parseInt(rightHand) + 7,
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));
					}
				}
				if( child.type === 'BinaryExpression' && child.operator == "<")
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1)
					{
						// get expression from original source code:
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])

						functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: parseInt(rightHand) - 7,
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));
					}
				}


				if( child.type === 'BinaryExpression' && child.operator == ">")
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1)
					{
						// get expression from original source code:
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])

						functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: parseInt(rightHand) + 7,
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));
					}
				}
				if( child.type === 'BinaryExpression' && child.operator == ">")
				{
					if( child.left.type == 'Identifier' && params.indexOf( child.left.name ) > -1)
					{
						// get expression from original source code:
						var expression = buf.substring(child.range[0], child.range[1]);
						var rightHand = buf.substring(child.right.range[0], child.right.range[1])

						functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: child.left.name,
								value: parseInt(rightHand) - 7,
								funcName: funcName,
								kind: "integer",
								operator : child.operator,
								expression: expression
							}));
					}
				}


				if( child.type === 'BinaryExpression' && child.left.type == 'CallExpression' && child.left.callee.property.name == 'indexOf')
				{
					var expression = buf.substring(child.range[0], child.range[1]);
					argument = child.left.arguments[0].raw;	
					idx = child.right.value;
					functionConstraints[funcName].constraints.push( 
						new Constraint(
							{
								ident: child.left.callee.object.name,
								value: argument,
								funcName: funcName,
								kind: 'indexOf',
								operator : child.operator,
								expression: expression
							}));
				}

				if( child.type === 'LogicalExpression' && child.operator == "||")
					{	
						if(child.left.type == 'UnaryExpression' && params.indexOf( child.left.argument.name ) >= 0)
						{
							var expression = buf.substring(child.range[0], child.range[1]);
							var rightHand = buf.substring(child.right.range[0], child.right.range[1]);
							functionConstraints[funcName].constraints.push( 
							new Constraint({
								ident: child.left.argument.name,
								value: '{'+child.right.argument.property.name+":true}",
								funcName: funcName,
								kind: 'bool',
								operator : child.operator,
								expression: expression
							}));
							functionConstraints[funcName].constraints.push( 
							new Constraint({
								ident: child.left.argument.name,
								value: '{'+child.right.argument.property.name+":false}",
								funcName: funcName,
								kind: 'bool',
								operator : child.operator,
								expression: expression
							}));
						}
					}
					if( child.type === 'LogicalExpression' && child.operator == "&&")
					{	
						if(child.left.type == 'UnaryExpression' && params.indexOf( child.left.argument.name ) >= 0)
						{
							var expression = buf.substring(child.range[0], child.range[1]);
							var rightHand = buf.substring(child.right.range[0], child.right.range[1]);
							functionConstraints[funcName].constraints.push( 
							new Constraint({
								ident: child.left.argument.name,
								value: '{'+child.right.argument.property.name+":true}",
								funcName: funcName,
								kind: 'bool',
								operator : child.operator,
								expression: expression
							}));
							functionConstraints[funcName].constraints.push( 
							new Constraint({
								ident: child.left.argument.name,
								value: '{'+child.right.argument.property.name+":false}",
								funcName: funcName,
								kind: 'bool',
								operator : child.operator,
								expression: expression
							}));
						}
					}


				if( child.type == "CallExpression" && 
					 child.callee.property &&
					 child.callee.property.name =="readFileSync" )
				{
					for( var p =0; p < params.length; p++ )
					{
						if( child.arguments[0].name == params[p] )
						{
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: params[p],
								value:  "'pathContent/file1'",
								funcName: funcName,
								kind: "fileWithContent",
								operator : child.operator,
								expression: expression
							}));
						}
					}
				}

				if( child.type == "CallExpression" &&
					 child.callee.property &&
					 child.callee.property.name =="existsSync")
				{
					for( var p =0; p < params.length; p++ )
					{
						if( child.arguments[0].name == params[p] )
						{
							functionConstraints[funcName].constraints.push( 
							new Constraint(
							{
								ident: params[p],
								// A fake path to a file
								value:  "'path/fileExists'",
								funcName: funcName,
								kind: "fileExists",
								operator : child.operator,
								expression: expression
							}));
						}
					}
				}

			});

			console.log( functionConstraints[funcName]);

		}
	});
}

function traverse(object, visitor) 
{
    var key, child;

    visitor.call(null, object);
    for (key in object) {
        if (object.hasOwnProperty(key)) {
            child = object[key];
            if (typeof child === 'object' && child !== null) {
                traverse(child, visitor);
            }
        }
    }
}

function traverseWithCancel(object, visitor)
{
    var key, child;

    if( visitor.call(null, object) )
    {
	    for (key in object) {
	        if (object.hasOwnProperty(key)) {
	            child = object[key];
	            if (typeof child === 'object' && child !== null) {
	                traverseWithCancel(child, visitor);
	            }
	        }
	    }
 	 }
}

function functionName( node )
{
	if( node.id )
	{
		return node.id.name;
	}
	return "";
}


if (!String.prototype.format) {
  String.prototype.format = function() {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function(match, number) { 
      return typeof args[number] != 'undefined'
        ? args[number]
        : match
      ;
    });
  };
}

main();