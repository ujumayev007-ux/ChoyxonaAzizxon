; Inno Setup Script for Azizxon Ofitsiant Desktop App
#define MyAppName "ChoyxonaAzizxon Ofitsiant"
#define MyAppVersion "2.1.0"
#define MyAppPublisher "Azizxon Software"
#define MyAppURL "https://azizxon.uz"
#define MyAppExeName "Azizxon-Ofitsiant.exe"

[Setup]
AppId={{2A4F918C-8D3E-4B10-9F12-7A9B3E148293}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\ChoyxonaAzizxon\Ofitsiant
DefaultGroupName=ChoyxonaAzizxon
DisableProgramGroupPage=yes
OutputDir=..\..\dist-installers
OutputBaseFilename=Azizxon_Ofitsiant_Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "uzbek"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\desktop\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\launch-ofitsiant.bat"; DestDir: "{app}"; DestName: "Azizxon-Ofitsiant.bat"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\Azizxon-Ofitsiant.bat"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\Azizxon-Ofitsiant.bat"; Tasks: desktopicon

[Run]
Filename: "{app}\Azizxon-Ofitsiant.bat"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: shellexec postinstall nowait skipifsilent

