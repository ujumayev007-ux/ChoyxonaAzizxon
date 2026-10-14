; Inno Setup Script for Azizxon Kassa POS Desktop App
#define MyAppName "ChoyxonaAzizxon Kassa POS"
#define MyAppVersion "2.1.0"
#define MyAppPublisher "Azizxon Software"
#define MyAppURL "https://azizxon.uz"
#define MyAppExeName "Azizxon-Kassa.exe"

[Setup]
AppId={{9C82A1B0-44F1-49F2-B270-3DF457F81822}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\ChoyxonaAzizxon\Kassa
DefaultGroupName=ChoyxonaAzizxon
DisableProgramGroupPage=yes
OutputDir=..\..\dist-installers
OutputBaseFilename=Azizxon_Kassa_Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "uzbek"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\desktop\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\launch-kassa.bat"; DestDir: "{app}"; DestName: "Azizxon-Kassa.bat"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\Azizxon-Kassa.bat"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\Azizxon-Kassa.bat"; Tasks: desktopicon

[Run]
Filename: "{app}\Azizxon-Kassa.bat"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: shellexec postinstall nowait skipifsilent

