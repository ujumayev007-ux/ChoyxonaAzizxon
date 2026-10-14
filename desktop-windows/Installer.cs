using System;
using System.IO;
using System.Reflection;
using System.Diagnostics;
using System.Windows.Forms;
using System.Drawing;
using Microsoft.Win32;

namespace ChoyxonaAzizxon
{
    public class Installer : Form
    {
        private TextBox txtInstallDir;
        private CheckBox chkKassa;
        private CheckBox chkOfitsiant;
        private CheckBox chkAdmin;
        private CheckBox chkSuperOwner;
        private CheckBox chkLaunchNow;
        private ProgressBar progressBar;
        private Label lblStatus;
        private Button btnInstall;
        private Button btnCancel;

        public Installer()
        {
            this.Text = "Choyxona Azizxon — O'rnatish Ustasi (Setup Wizard)";
            this.Size = new Size(580, 520);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(15, 23, 42);
            this.ForeColor = Color.White;
            this.Font = new Font("Segoe UI", 9.5f);

            BuildUI();
        }

        private void BuildUI()
        {
            // Banner Header
            Panel pnlHeader = new Panel()
            {
                Location = new Point(0, 0),
                Size = new Size(580, 85),
                BackColor = Color.FromArgb(30, 41, 59)
            };

            Label lblTitle = new Label()
            {
                Text = "Choyxona Azizxon — Tijoriy Tizimini O'rnatish",
                Location = new Point(24, 18),
                Size = new Size(520, 28),
                Font = new Font("Segoe UI", 13f, FontStyle.Bold),
                ForeColor = Color.FromArgb(245, 158, 11)
            };
            pnlHeader.Controls.Add(lblTitle);

            Label lblSub = new Label()
            {
                Text = "Kassa, Ofitsiant, Admin va Super Owner desktop dasturlari o'rnatilmoqda.",
                Location = new Point(26, 48),
                Size = new Size(520, 22),
                Font = new Font("Segoe UI", 9f),
                ForeColor = Color.FromArgb(148, 163, 184)
            };
            pnlHeader.Controls.Add(lblSub);
            this.Controls.Add(pnlHeader);

            // Install Directory
            Label lblDir = new Label()
            {
                Text = "O'rnatish papkasi:",
                Location = new Point(28, 105),
                Size = new Size(400, 20),
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(226, 232, 240)
            };
            this.Controls.Add(lblDir);

            string defaultDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "ChoyxonaAzizxon");

            txtInstallDir = new TextBox()
            {
                Text = defaultDir,
                Location = new Point(28, 130),
                Size = new Size(410, 28),
                BackColor = Color.FromArgb(30, 41, 59),
                ForeColor = Color.White,
                BorderStyle = BorderStyle.FixedSingle
            };
            this.Controls.Add(txtInstallDir);

            Button btnBrowse = new Button()
            {
                Text = "Ko'rish...",
                Location = new Point(448, 128),
                Size = new Size(95, 30),
                BackColor = Color.FromArgb(51, 65, 85),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnBrowse.FlatAppearance.BorderSize = 0;
            btnBrowse.Click += (s, e) =>
            {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.SelectedPath = txtInstallDir.Text;
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        txtInstallDir.Text = fbd.SelectedPath;
                    }
                }
            };
            this.Controls.Add(btnBrowse);

            // Components Box
            GroupBox grpComp = new GroupBox()
            {
                Text = "Ish stoli yorliqlari (Desktop Shortcuts):",
                Location = new Point(28, 175),
                Size = new Size(515, 170),
                ForeColor = Color.FromArgb(245, 158, 11),
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold)
            };

            chkKassa = new CheckBox()
            {
                Text = "💳 Azizxon — Kassa (Kassir to'lov va buyurtmalar)",
                Checked = true,
                Location = new Point(20, 30),
                Size = new Size(470, 26),
                Font = new Font("Segoe UI", 9.5f),
                ForeColor = Color.FromArgb(241, 245, 249)
            };
            grpComp.Controls.Add(chkKassa);

            chkOfitsiant = new CheckBox()
            {
                Text = "🍽️ Azizxon — Ofitsiant (Stollar va xizmat ko'rsatish)",
                Checked = true,
                Location = new Point(20, 60),
                Size = new Size(470, 26),
                Font = new Font("Segoe UI", 9.5f),
                ForeColor = Color.FromArgb(241, 245, 249)
            };
            grpComp.Controls.Add(chkOfitsiant);

            chkAdmin = new CheckBox()
            {
                Text = "📊 Azizxon — Admin (Hisobotlar, sozlamalar va omborxona)",
                Checked = true,
                Location = new Point(20, 90),
                Size = new Size(470, 26),
                Font = new Font("Segoe UI", 9.5f),
                ForeColor = Color.FromArgb(241, 245, 249)
            };
            grpComp.Controls.Add(chkAdmin);

            chkSuperOwner = new CheckBox()
            {
                Text = "👑 Azizxon — Super Owner HQ (Litsenziyalar va SaaS nazorati)",
                Checked = true,
                Location = new Point(20, 120),
                Size = new Size(470, 26),
                Font = new Font("Segoe UI", 9.5f),
                ForeColor = Color.FromArgb(241, 245, 249)
            };
            grpComp.Controls.Add(chkSuperOwner);

            this.Controls.Add(grpComp);

            chkLaunchNow = new CheckBox()
            {
                Text = "O'rnatilgach, darhol Kassa dasturini ishga tushirish",
                Checked = true,
                Location = new Point(28, 355),
                Size = new Size(450, 24),
                ForeColor = Color.FromArgb(148, 163, 184)
            };
            this.Controls.Add(chkLaunchNow);

            // Progress bar
            progressBar = new ProgressBar()
            {
                Location = new Point(28, 385),
                Size = new Size(515, 12),
                Visible = false
            };
            this.Controls.Add(progressBar);

            lblStatus = new Label()
            {
                Text = "O'rnatishga tayyor.",
                Location = new Point(28, 402),
                Size = new Size(515, 20),
                ForeColor = Color.FromArgb(148, 163, 184),
                Font = new Font("Segoe UI", 8.5f)
            };
            this.Controls.Add(lblStatus);

            // Bottom Buttons
            btnInstall = new Button()
            {
                Text = "O'rnatish (Install)",
                Location = new Point(373, 428),
                Size = new Size(170, 42),
                BackColor = Color.FromArgb(245, 158, 11),
                ForeColor = Color.FromArgb(15, 23, 42),
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Click += StartInstallation;
            this.Controls.Add(btnInstall);

            btnCancel = new Button()
            {
                Text = "Bekor qilish",
                Location = new Point(245, 428),
                Size = new Size(120, 42),
                BackColor = Color.FromArgb(51, 65, 85),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            btnCancel.FlatAppearance.BorderSize = 0;
            btnCancel.Click += (s, e) => this.Close();
            this.Controls.Add(btnCancel);
        }

        private void StartInstallation(object sender, EventArgs e)
        {
            btnInstall.Enabled = false;
            btnCancel.Enabled = false;
            progressBar.Visible = true;
            progressBar.Value = 10;

            string targetDir = txtInstallDir.Text.Trim();
            try
            {
                Directory.CreateDirectory(targetDir);
            }
            catch (Exception ex)
            {
                MessageBox.Show("Papkaga yozishda xatolik: " + ex.Message, "Xatolik", MessageBoxButtons.OK, MessageBoxIcon.Error);
                btnInstall.Enabled = true;
                btnCancel.Enabled = true;
                return;
            }

            lblStatus.Text = "Fayllar ko'chirilmoqda...";
            progressBar.Value = 35;

            string sourceDir = AppDomain.CurrentDomain.BaseDirectory;

            // Copy executables, config, and icons
            string[] filesToCopy = new string[]
            {
                "Azizxon_Admin.exe",
                "Azizxon_Kassa.exe",
                "Azizxon_Ofitsiant.exe",
                "Azizxon_SuperOwner.exe",
                "config.json",
                "favicon.ico"
            };

            foreach (string file in filesToCopy)
            {
                string src = Path.Combine(sourceDir, file);
                string dst = Path.Combine(targetDir, file);
                if (File.Exists(src))
                {
                    try { File.Copy(src, dst, true); } catch { }
                }
            }

            progressBar.Value = 60;
            lblStatus.Text = "Yorliqlar yaratilmoqda...";

            string desktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string startMenuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Choyxona Azizxon");
            Directory.CreateDirectory(startMenuDir);

            if (chkKassa.Checked)
            {
                string kassaExe = Path.Combine(targetDir, "Azizxon_Kassa.exe");
                CreateShortcut(Path.Combine(desktopDir, "Choyxona Azizxon — Kassa.lnk"), kassaExe, "Choyxona Azizxon Kassa Dasturi", targetDir);
                CreateShortcut(Path.Combine(startMenuDir, "Kassa.lnk"), kassaExe, "Kassa Dasturi", targetDir);
            }

            if (chkOfitsiant.Checked)
            {
                string ofitsiantExe = Path.Combine(targetDir, "Azizxon_Ofitsiant.exe");
                CreateShortcut(Path.Combine(desktopDir, "Choyxona Azizxon — Ofitsiant.lnk"), ofitsiantExe, "Choyxona Azizxon Ofitsiant Dasturi", targetDir);
                CreateShortcut(Path.Combine(startMenuDir, "Ofitsiant.lnk"), ofitsiantExe, "Ofitsiant Dasturi", targetDir);
            }

            if (chkAdmin.Checked)
            {
                string adminExe = Path.Combine(targetDir, "Azizxon_Admin.exe");
                CreateShortcut(Path.Combine(desktopDir, "Choyxona Azizxon — Admin.lnk"), adminExe, "Choyxona Azizxon Boshqaruv Paneli", targetDir);
                CreateShortcut(Path.Combine(startMenuDir, "Admin Boshqaruv.lnk"), adminExe, "Admin Boshqaruv", targetDir);
            }

            if (chkSuperOwner.Checked)
            {
                string ownerExe = Path.Combine(targetDir, "Azizxon_SuperOwner.exe");
                CreateShortcut(Path.Combine(desktopDir, "Choyxona Azizxon — Super Owner HQ.lnk"), ownerExe, "Super Owner Master HQ", targetDir);
                CreateShortcut(Path.Combine(startMenuDir, "Super Owner HQ.lnk"), ownerExe, "Super Owner HQ", targetDir);
            }

            // Create Uninstaller
            CreateUninstaller(targetDir);

            // Register in Windows Control Panel
            RegisterInControlPanel(targetDir);

            progressBar.Value = 100;
            lblStatus.Text = "O'rnatish muvaffaqiyatli yakunlandi!";

            MessageBox.Show(
                "Choyxona Azizxon tizimi muvaffaqiyatli o'rnatildi!\nIsh stolingizda kerakli yorliqlar yaratildi.",
                "Muvaffaqiyatli O'rnatildi",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);

            if (chkLaunchNow.Checked)
            {
                string kassaExe = Path.Combine(targetDir, "Azizxon_Kassa.exe");
                if (File.Exists(kassaExe))
                {
                    Process.Start(kassaExe);
                }
            }

            this.Close();
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string description, string workingDir)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.WorkingDirectory = workingDir;
                shortcut.Description = description;
                shortcut.IconLocation = targetPath + ",0";
                shortcut.Save();
            }
            catch { }
        }

        private static void CreateUninstaller(string installDir)
        {
            try
            {
                string uninstallBat = Path.Combine(installDir, "Uninstall.bat");
                string content = string.Format(
                    "@echo off\r\n" +
                    "title Choyxona Azizxon — O'chirish\r\n" +
                    "echo Choyxona Azizxon dasturi o'chirilmoqda...\r\n" +
                    "del /q \"%userprofile%\\Desktop\\Choyxona Azizxon*.lnk\" 2>nul\r\n" +
                    "rmdir /s /q \"%appdata%\\Microsoft\\Windows\\Start Menu\\Programs\\Choyxona Azizxon\" 2>nul\r\n" +
                    "reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ChoyxonaAzizxon\" /f 2>nul\r\n" +
                    "echo O'chirish yakunlandi.\r\n" +
                    "timeout /t 2 >nul\r\n" +
                    "(goto) 2>nul & rmdir /s /q \"{0}\"\r\n", installDir);
                File.WriteAllText(uninstallBat, content);
            }
            catch { }
        }

        private static void RegisterInControlPanel(string installDir)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\ChoyxonaAzizxon"))
                {
                    key.SetValue("DisplayName", "Choyxona Azizxon — Tijoriy Restoran Tizimi");
                    key.SetValue("DisplayVersion", "2.1.0");
                    key.SetValue("Publisher", "Choyxona Azizxon Technologies");
                    key.SetValue("DisplayIcon", Path.Combine(installDir, "Azizxon_Kassa.exe"));
                    key.SetValue("InstallLocation", installDir);
                    key.SetValue("UninstallString", "\"" + Path.Combine(installDir, "Uninstall.bat") + "\"");
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                }
            }
            catch { }
        }

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Installer());
        }
    }
}

