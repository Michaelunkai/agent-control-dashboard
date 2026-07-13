Option Explicit

Dim shell, fileSystem, nodePath, serverPath, workingDirectory, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

nodePath = "node.exe"
workingDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
serverPath = fileSystem.BuildPath(workingDirectory, "dist\server.js")
command = """" & nodePath & """ """ & serverPath & """"

shell.CurrentDirectory = workingDirectory
WScript.Quit shell.Run(command, 0, False)
