using System;
using System.IO;
using System.Diagnostics;
using System.Net.Sockets;
using System.Windows.Forms;
using System.Drawing;
using System.Threading;

namespace ChoyxonaAzizxon
{
    public class Launcher
    {
        private static string DefaultRole = "admin";

        [STAThread]
        public static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            #if ROLE_CASHIER
            DefaultRole = "cashier";
            #elif ROLE_WAITER
            DefaultRole = "waiter";
            #elif ROLE_OWNER
            DefaultRole = "super-owner";
            #elif ROLE_ADMIN
            DefaultRole = "admin";
            #endif

            string role = DefaultRole;
            bool forceConfig = false;

            foreach (string arg in args)
            {
                if (arg.StartsWith("--role=", StringComparison.OrdinalIgnoreCase))
                {
                    role = arg.Substring(7).Trim();
                }
                else if (arg.Equals("--config", StringComparison.OrdinalIgnoreCase) || arg.Equals("-c", StringComparison.OrdinalIgnoreCase))
                {
                    forceConfig = true;
                }
            }

            // Check if Shift or Ctrl key was held down on launch
            if ((Control.ModifierKeys & (Keys.Shift | Keys.Control)) != 0)
            {
                forceConfig = true;
            }

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string configFile = Path.Combine(baseDir, "config.json");

            string serverUrl = "http://localhost:3000";
            if (File.Exists(configFile))
            {
                try
                {
                    string content = File.ReadAllText(configFile);
                    int idx = content.IndexOf("\"serverUrl\":", StringComparison.OrdinalIgnoreCase);
                    if (idx != -1)
                    {
                        int startQuote = content.IndexOf("\"", idx + 12);
                        int endQuote = content.IndexOf("\"", startQuote + 1);
                        if (startQuote != -1 && endQuote != -1)
                        {
                            serverUrl = content.Substring(startQuote + 1, endQuote - startQuote - 1).Trim();
                        }
                    }
                }
                catch { }
            }

            if (forceConfig)
            {
                serverUrl = ShowConfigDialog(serverUrl, role);
                if (string.IsNullOrEmpty(serverUrl)) return;
            }

            // If localhost, ensure backend server is running
            Uri uri;
            try { uri = new Uri(serverUrl); }
            catch { uri = new Uri("http://localhost:3000"); }

            if (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || uri.Host.Equals("127.0.0.1"))
            {
                EnsureLocalServerRunning(baseDir, uri.Port);
            }

            LaunchBrowserApp(serverUrl, role);
        }

        private static void EnsureLocalServerRunning(string baseDir, int port)
        {
            if (IsPortOpen("127.0.0.1", port, 400)) return;

            // Search for server start script or entrypoint
            string[] candidates = new string[]
            {
                Path.Combine(baseDir, "server", "dist", "server.js"),
                Path.Combine(baseDir, "dist", "server.js"),
                Path.Combine(baseDir, "..", "dist", "server.js"),
                Path.Combine(baseDir, "launch-server.bat"),
                Path.Combine(baseDir, "..", "package.json")
            };

            string serverScript = null;
            string workingDir = baseDir;

            foreach (string c in candidates)
            {
                if (File.Exists(c))
                {
                    serverScript = c;
                    workingDir = Path.GetDirectoryName(Path.GetFullPath(c));
                    break;
                }
            }

            if (serverScript != null)
            {
                try
                {
                    ProcessStartInfo psi;
                    if (serverScript.EndsWith(".bat", StringComparison.OrdinalIgnoreCase))
                    {
                        psi = new ProcessStartInfo("cmd.exe", "/c \"" + serverScript + "\"");
                    }
                    else if (serverScript.EndsWith("package.json", StringComparison.OrdinalIgnoreCase))
                    {
                        psi = new ProcessStartInfo("cmd.exe", "/c npm start");
                    }
                    else
                    {
                        psi = new ProcessStartInfo("node", "\"" + serverScript + "\"");
                    }

                    psi.WorkingDirectory = workingDir;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;

                    Process.Start(psi);

                    // Wait up to 6 seconds for port to open
                    for (int i = 0; i < 20; i++)
                    {
                        Thread.Sleep(300);
                        if (IsPortOpen("127.0.0.1", port, 200)) break;
                    }
                }
                catch { }
            }
        }

        private static bool IsPortOpen(string host, int port, int timeoutMs)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    var result = client.BeginConnect(host, port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(timeoutMs);
                    if (!success) return false;
                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void LaunchBrowserApp(string serverUrl, string role)
        {
            if (serverUrl.EndsWith("/")) serverUrl = serverUrl.Substring(0, serverUrl.Length - 1);

            string targetUrl;
            string profileName;

            if (role.Equals("cashier", StringComparison.OrdinalIgnoreCase))
            {
                targetUrl = serverUrl + "/cashier/";
                profileName = "kassa";
            }
            else if (role.Equals("waiter", StringComparison.OrdinalIgnoreCase))
            {
                targetUrl = serverUrl + "/waiter/";
                profileName = "ofitsiant";
            }
            else if (role.Equals("super-owner", StringComparison.OrdinalIgnoreCase))
            {
                targetUrl = serverUrl + "/super-owner/";
                profileName = "superowner";
            }
            else if (role.Equals("kitchen", StringComparison.OrdinalIgnoreCase))
            {
                targetUrl = serverUrl + "/kitchen/";
                profileName = "oshxona";
            }
            else
            {
                targetUrl = serverUrl + "/admin/";
                profileName = "admin";
            }

            string browserPath = FindBrowser();
            string profileDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChoyxonaAzizxon", "Profiles", profileName);

            try { Directory.CreateDirectory(profileDir); } catch { }

            if (!string.IsNullOrEmpty(browserPath))
            {
                string args = string.Format("--app=\"{0}\" --user-data-dir=\"{1}\" --window-size=1280,850", targetUrl, profileDir);
                ProcessStartInfo psi = new ProcessStartInfo(browserPath, args);
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            else
            {
                Process.Start(targetUrl);
            }
        }

        private static string FindBrowser()
        {
            string[] paths = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
            };

            foreach (string p in paths)
            {
                if (File.Exists(p)) return p;
            }

            return null;
        }

        private static string ShowConfigDialog(string currentUrl, string role)
        {
            using (Form form = new Form())
            {
                form.Text = "Choyxona Azizxon — Server Sozlamalari";
                form.Size = new Size(460, 260);
                form.StartPosition = FormStartPosition.CenterScreen;
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.MaximizeBox = false;
                form.MinimizeBox = false;
                form.BackColor = Color.FromArgb(15, 23, 42);
                form.ForeColor = Color.White;
                form.Font = new Font("Segoe UI", 9.5f);

                Label lblHeader = new Label()
                {
                    Text = "Server Manzilini O'zgartirish (" + role.ToUpper() + ")",
                    Location = new Point(24, 20),
                    Size = new Size(400, 25),
                    Font = new Font("Segoe UI", 11f, FontStyle.Bold),
                    ForeColor = Color.FromArgb(245, 158, 11)
                };
                form.Controls.Add(lblHeader);

                Label lblPrompt = new Label()
                {
                    Text = "Server IP manzili yoki domen (masalan: http://192.168.1.100:3000):",
                    Location = new Point(24, 55),
                    Size = new Size(400, 22),
                    ForeColor = Color.FromArgb(203, 213, 225)
                };
                form.Controls.Add(lblPrompt);

                TextBox txtUrl = new TextBox()
                {
                    Text = currentUrl,
                    Location = new Point(24, 85),
                    Size = new Size(395, 28),
                    BackColor = Color.FromArgb(30, 41, 59),
                    ForeColor = Color.White,
                    BorderStyle = BorderStyle.FixedSingle
                };
                form.Controls.Add(txtUrl);

                Button btnSave = new Button()
                {
                    Text = "Saqlash va Ulanish",
                    Location = new Point(230, 145),
                    Size = new Size(190, 42),
                    BackColor = Color.FromArgb(245, 158, 11),
                    ForeColor = Color.FromArgb(15, 23, 42),
                    FlatStyle = FlatStyle.Flat,
                    Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                    Cursor = Cursors.Hand
                };
                btnSave.FlatAppearance.BorderSize = 0;
                btnSave.Click += (s, e) =>
                {
                    string val = txtUrl.Text.Trim();
                    if (!val.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !val.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    {
                        val = "http://" + val;
                    }

                    try
                    {
                        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                        string json = string.Format("{{\n  \"serverUrl\": \"{0}\",\n  \"updatedAt\": \"{1}\"\n}}", val, DateTime.Now.ToString("s"));
                        File.WriteAllText(Path.Combine(baseDir, "config.json"), json);
                    }
                    catch { }

                    form.DialogResult = DialogResult.OK;
                    form.Close();
                };
                form.Controls.Add(btnSave);

                Button btnCancel = new Button()
                {
                    Text = "Bekor qilish",
                    Location = new Point(100, 145),
                    Size = new Size(120, 42),
                    BackColor = Color.FromArgb(51, 65, 85),
                    ForeColor = Color.White,
                    FlatStyle = FlatStyle.Flat,
                    Cursor = Cursors.Hand
                };
                btnCancel.FlatAppearance.BorderSize = 0;
                btnCancel.Click += (s, e) => { form.DialogResult = DialogResult.Cancel; form.Close(); };
                form.Controls.Add(btnCancel);

                if (form.ShowDialog() == DialogResult.OK)
                {
                    return txtUrl.Text.Trim();
                }

                return null;
            }
        }
    }
}

