; Inno Setup Script for Azizxon Admin Desktop App
#define MyAppName "ChoyxonaAzizxon Admin"
#define MyAppVersion "2.1.0"
#define MyAppPublisher "Azizxon Software"
#define MyAppURL "https://azizxon.uz"
#define MyAppExeName "Azizxon-Admin.exe"

[Setup]
AppId={{5E731F2A-23C7-412E-9AB1-7BF473C30691}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\ChoyxonaAzizxon\Admin
DefaultGroupName=ChoyxonaAzizxon
DisableProgramGroupPage=yes
OutputDir=..\..\dist-installers
OutputBaseFilename=Azizxon_Admin_Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "uzbek"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\desktop\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\launch-admin.bat"; DestDir: "{app}"; DestName: "Azizxon-Admin.bat"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\Azizxon-Admin.bat"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\Azizxon-Admin.bat"; Tasks: desktopicon

[Run]
Filename: "{app}\Azizxon-Admin.bat"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: shellexec postinstall nowait skipifsilent

